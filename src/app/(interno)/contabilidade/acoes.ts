"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { NaturezaConta, OrigemLancamento, SituacaoPeriodo } from "@prisma/client";
import { comEscritorio } from "@/lib/db";
import { acessoParaAcao, type Acesso } from "@/lib/auth/sessao";
import type { Acao } from "@/lib/auth/permissoes";
import { ErroDeNegocio } from "@/lib/erros";
import { estadoDeErro, SEM_PERMISSAO, texto, type EstadoForm } from "@/lib/form";
import { obterClienteVisivel } from "@/lib/clientes";
import { atualizarConta, copiarPlanoParaCliente, criarConta, garantirModeloPadrao } from "@/lib/contabil/plano";
import { criarLancamento, editarLancamento, estornarLancamento, lerCompetencia, type LancamentoEntrada, type PartidaEntrada } from "@/lib/contabil/lancamentos";
import { apurarResultado, mudarSituacaoPeriodo } from "@/lib/contabil/periodos";
import { aplicarImportacaoContabil, receberPlano, receberSaldos } from "@/lib/contabil/importacoes";

const autorDe = (a: Acesso) => ({ id: a.usuario.id, escritorioId: a.usuario.escritorioId, perfil: a.usuario.perfil });

async function executar(acao: Acao, f: FormData | null, fn: (a: Acesso) => Promise<EstadoForm | void>, timeout?: number): Promise<EstadoForm> {
  const a = await acessoParaAcao(acao);
  if (!a) return SEM_PERMISSAO;
  void timeout;
  try {
    return (await fn(a)) ?? { ok: true };
  } catch (e) {
    return estadoDeErro(e, f ?? undefined);
  }
}

function lancamentoDe(f: FormData): LancamentoEntrada {
  let partidas: PartidaEntrada[] = [];
  try {
    partidas = JSON.parse(String(f.get("partidas") ?? "[]"));
  } catch {
    throw new ErroDeNegocio("Partidas inválidas.");
  }
  if (!Array.isArray(partidas) || partidas.length > 200) throw new ErroDeNegocio("Partidas inválidas.");
  return {
    data: texto(f, "data"),
    historico: texto(f, "historico"),
    origem: (texto(f, "origem") || "MANUAL") as OrigemLancamento,
    justificativa: texto(f, "justificativa"),
    partidas: partidas.map((p) => ({ conta: String(p.conta ?? ""), tipo: p.tipo, valor: String(p.valor ?? ""), historico: String(p.historico ?? "") })),
  };
}

const ORIGENS_LIVRES: OrigemLancamento[] = ["MANUAL", "AJUSTE", "PROVISAO"];

export async function acaoNovoLancamento(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  let destino = "";
  const r = await executar("contabil.lancar", f, async (a) => {
    const e = lancamentoDe(f);
    if (!ORIGENS_LIVRES.includes(e.origem!)) throw new ErroDeNegocio("Tipo de lançamento inválido.");
    const l = await comEscritorio(a.ctx, (tx) => criarLancamento(tx, autorDe(a), clienteId, e));
    destino = texto(f, "continuar") === "sim"
      ? `/contabilidade/${clienteId}/lancamentos/novo?ultimo=${l.numero}&data=${e.data}`
      : `/contabilidade/${clienteId}?mes=${e.data.slice(0, 7)}&criado=${l.numero}`;
  });
  if (destino) redirect(destino);
  return { ...r, dados: { partidas: String(f.get("partidas") ?? "[]") } };
}

export async function acaoEditarLancamento(clienteId: string, lancamentoId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  let destino = "";
  const r = await executar("contabil.lancar", f, async (a) => {
    const e = lancamentoDe(f);
    if (!ORIGENS_LIVRES.includes(e.origem!)) throw new ErroDeNegocio("Tipo de lançamento inválido.");
    await comEscritorio(a.ctx, (tx) => editarLancamento(tx, autorDe(a), clienteId, lancamentoId, e));
    destino = `/contabilidade/${clienteId}/lancamentos/${lancamentoId}?salvo=1`;
  });
  if (destino) redirect(destino);
  return { ...r, dados: { partidas: String(f.get("partidas") ?? "[]") } };
}

export async function acaoEstornar(clienteId: string, lancamentoId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  let destino = "";
  const r = await executar("contabil.lancar", f, async (a) => {
    const est = await comEscritorio(a.ctx, (tx) => estornarLancamento(tx, autorDe(a), clienteId, lancamentoId, texto(f, "data"), texto(f, "justificativa")));
    destino = `/contabilidade/${clienteId}/lancamentos/${est.id}?estorno=1`;
  });
  if (destino) redirect(destino);
  return r;
}

export async function acaoPeriodo(clienteId: string, competencia: string, para: SituacaoPeriodo, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  const precisa: Acao = para === "FECHADO" || texto(f, "de") === "FECHADO" ? "contabil.fechar" : "contabil.conferencia";
  return executar(precisa, f, async (a) => {
    const justificativasContas: Record<string, string> = {};
    for (const [k, v] of f.entries()) if (k.startsWith("conta:") && typeof v === "string") justificativasContas[k.slice(6)] = v;
    await comEscritorio(a.ctx, (tx) =>
      mudarSituacaoPeriodo(tx, autorDe(a), clienteId, { competencia: lerCompetencia(competencia), para, justificativa: texto(f, "justificativa"), justificativasContas }),
    { timeout: 60000 });
    revalidatePath(`/contabilidade/${clienteId}`, "layout");
    return { ok: true, mensagem: "Situação do período atualizada." };
  });
}

export async function acaoApurar(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("contabil.fechar", f, async (a) => {
    const l = await comEscritorio(a.ctx, (tx) => apurarResultado(tx, autorDe(a), clienteId, Number(texto(f, "ano")), texto(f, "contaDestinoId")), { timeout: 60000 });
    revalidatePath(`/contabilidade/${clienteId}`, "layout");
    return { ok: true, mensagem: `Resultado apurado no lançamento nº ${l.numero}.` };
  });
}

// Plano de contas ----------------------------------------------------------

async function planoEditavel(a: Acesso, planoId: string) {
  return comEscritorio(a.ctx, async (tx) => {
    const plano = await tx.planoDeContas.findUnique({ where: { id: planoId } });
    if (!plano) throw new ErroDeNegocio("Plano não encontrado.");
    if (plano.clienteId && !(await obterClienteVisivel(tx, autorDe(a), plano.clienteId))) throw new ErroDeNegocio("Plano não encontrado.");
    return plano;
  });
}

const caminhoPlano = (p: { id: string; clienteId: string | null }) => (p.clienteId ? `/contabilidade/${p.clienteId}/plano` : `/contabilidade/modelos/${p.id}`);

export async function acaoCriarConta(planoId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("contabil.plano", f, async (a) => {
    const plano = await planoEditavel(a, planoId);
    await comEscritorio(a.ctx, (tx) =>
      criarConta(tx, a.usuario.escritorioId, planoId, {
        codigo: texto(f, "codigo"), nome: texto(f, "nome"), analitica: texto(f, "tipo") === "A",
        natureza: (texto(f, "natureza") || undefined) as NaturezaConta | undefined, disponivel: texto(f, "disponivel") === "sim",
        codigoReferencial: texto(f, "referencial"),
      }),
    );
    revalidatePath(caminhoPlano(plano));
    return { ok: true, mensagem: `Conta ${texto(f, "codigo")} criada.` };
  });
}

export async function acaoAtualizarConta(planoId: string, contaId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("contabil.plano", f, async (a) => {
    const plano = await planoEditavel(a, planoId);
    await comEscritorio(a.ctx, async (tx) => {
      const conta = await tx.contaContabil.findFirst({ where: { id: contaId, planoId } });
      if (!conta) throw new ErroDeNegocio("Conta não encontrada.");
      await atualizarConta(tx, contaId, {
        nome: texto(f, "nome"), natureza: texto(f, "natureza") as NaturezaConta, ativa: texto(f, "ativa") === "sim",
        disponivel: texto(f, "disponivel") === "sim", codigoReferencial: texto(f, "referencial"),
      });
    });
    revalidatePath(caminhoPlano(plano));
    return { ok: true, mensagem: "Conta atualizada." };
  });
}

export async function acaoCopiarModelo(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  let ok = false;
  const r = await executar("contabil.plano", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => copiarPlanoParaCliente(tx, autorDe(a), clienteId, texto(f, "modeloId")), { timeout: 60000 });
    ok = true;
  });
  if (ok) redirect(`/contabilidade/${clienteId}/plano`);
  return r;
}

export async function acaoCriarModeloPadrao(): Promise<EstadoForm> {
  const r = await executar("contabil.plano", null, async (a) => {
    await comEscritorio(a.ctx, (tx) => garantirModeloPadrao(tx, a.usuario.escritorioId), { timeout: 60000 });
  });
  revalidatePath("/contabilidade/modelos");
  return r;
}

// Importações -----------------------------------------------------------------

async function arquivoDe(f: FormData) {
  const arq = f.get("arquivo");
  if (!(arq instanceof File) || arq.size === 0) throw new ErroDeNegocio("Escolha a planilha.");
  return { nome: arq.name, conteudo: Buffer.from(await arq.arrayBuffer()) };
}

export async function acaoReceberContabil(clienteId: string, tipo: "PLANO" | "SALDOS", _: EstadoForm, f: FormData): Promise<EstadoForm> {
  let destino = "";
  const r = await executar("contabil.importar", f, async (a) => {
    const arq = await arquivoDe(f);
    const imp = await comEscritorio(a.ctx, (tx) => (tipo === "PLANO" ? receberPlano(tx, autorDe(a), clienteId, arq) : receberSaldos(tx, autorDe(a), clienteId, texto(f, "data"), arq)), { timeout: 60000 });
    destino = `/contabilidade/${clienteId}/importar?conferir=${imp.id}`;
  });
  if (destino) redirect(destino);
  return r;
}

export async function acaoAplicarContabil(clienteId: string, importacaoId: string, _: EstadoForm): Promise<EstadoForm> {
  return executar("contabil.importar", null, async (a) => {
    await comEscritorio({ ...a.ctx, origem: "web:importacao" }, (tx) => aplicarImportacaoContabil(tx, autorDe(a), clienteId, importacaoId), { timeout: 120000 });
    revalidatePath(`/contabilidade/${clienteId}`, "layout");
    return { ok: true, mensagem: "Importação aplicada." };
  });
}
