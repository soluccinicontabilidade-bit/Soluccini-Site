"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { TipoContaBancaria, TipoTitulo } from "@prisma/client";
import { comEscritorio } from "@/lib/db";
import { acessoParaAcao, type Acesso } from "@/lib/auth/sessao";
import type { Acao } from "@/lib/auth/permissoes";
import { ErroDeNegocio } from "@/lib/erros";
import { estadoDeErro, SEM_PERMISSAO, texto, valoresDe, type EstadoForm } from "@/lib/form";
import { obterClienteVisivel } from "@/lib/clientes";
import { enviarDocumento } from "@/lib/documentos";
import { lerCompetencia } from "@/lib/contabil/lancamentos";
import {
  baixarParcela, cancelarTitulo, criarCategoria, criarCentroDeCusto, criarContaBancaria, criarTitulo, criarTransferencia,
  estornarBaixa, garantirCategoriasPadrao, pedirAprovacao, type RateioEntrada,
} from "@/lib/financeiro/financeiro";
import { importarExtrato } from "@/lib/financeiro/ofx";
import {
  aplicarRegras, conciliar, desfazerConciliacao, fecharConciliacao, ignorarTransacao, lancarDaTransacao, reabrirConciliacao, reativarTransacao, sugerir,
} from "@/lib/financeiro/conciliacao";
import { sincronizarContabil } from "@/lib/financeiro/integracao";

const autorDe = (a: Acesso) => ({ id: a.usuario.id, escritorioId: a.usuario.escritorioId, perfil: a.usuario.perfil });

async function executar(acao: Acao, f: FormData | null, fn: (a: Acesso) => Promise<EstadoForm | void>): Promise<EstadoForm> {
  const a = await acessoParaAcao(acao);
  if (!a) return SEM_PERMISSAO;
  try {
    return (await fn(a)) ?? { ok: true };
  } catch (e) {
    return estadoDeErro(e, f ?? undefined);
  }
}
const T = 60000;
const rev = (clienteId: string) => revalidatePath(`/financeiro/${clienteId}`, "layout");

export async function acaoNovoTitulo(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  let destino = "";
  const r = await executar("financeiro.operar", f, async (a) => {
    let rateios: RateioEntrada[] = [];
    try {
      rateios = JSON.parse(texto(f, "rateios") || "[]");
    } catch {
      throw new ErroDeNegocio("Rateio inválido.");
    }
    const usarRateio = texto(f, "usarRateio") === "sim" && rateios.length > 0;
    const criados = await comEscritorio(a.ctx, (tx) =>
      criarTitulo(tx, autorDe(a), clienteId, {
        tipo: texto(f, "tipo") as TipoTitulo, descricao: texto(f, "descricao"), favorecido: texto(f, "favorecido"), documentoFavorecido: texto(f, "documentoFavorecido"),
        documento: texto(f, "documento"), competencia: texto(f, "competencia"), valor: texto(f, "valor"),
        categoriaId: texto(f, "categoriaId"), centroCustoId: texto(f, "centroCustoId") || undefined, rateios: usarRateio ? rateios : undefined,
        parcelas: Number(texto(f, "parcelas") || 1), primeiroVencimento: texto(f, "vencimento"), contaPrevistaId: texto(f, "contaPrevistaId") || undefined,
        repetirMeses: Number(texto(f, "repetirMeses") || 0), observacao: texto(f, "observacao"),
      }), { timeout: T });
    destino = texto(f, "continuar") === "sim" ? `/financeiro/${clienteId}/novo?criado=${criados.length}&tipo=${texto(f, "tipo")}` : `/financeiro/${clienteId}/titulos/${criados[0].id}?criado=1`;
  });
  if (destino) redirect(destino);
  return { ...r, valores: valoresDe(f), dados: { rateios: texto(f, "rateios") } };
}

export async function acaoBaixar(clienteId: string, parcelaId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("financeiro.operar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => baixarParcela(tx, autorDe(a), clienteId, parcelaId, { data: texto(f, "data"), contaId: texto(f, "contaId"), juros: texto(f, "juros"), multa: texto(f, "multa"), desconto: texto(f, "desconto") }));
    rev(clienteId);
    return { ok: true, mensagem: "Baixa registrada." };
  });
}

export async function acaoEstornarBaixa(clienteId: string, parcelaId: string, _: EstadoForm): Promise<EstadoForm> {
  return executar("financeiro.operar", null, async (a) => {
    await comEscritorio(a.ctx, (tx) => estornarBaixa(tx, autorDe(a), clienteId, parcelaId));
    rev(clienteId);
    return { ok: true, mensagem: "Baixa estornada." };
  });
}

export async function acaoPedirAprovacao(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("financeiro.operar", f, async (a) => {
    const n = await comEscritorio(a.ctx, (tx) => pedirAprovacao(tx, autorDe(a), clienteId, f.getAll("parcelas").map(String)));
    rev(clienteId);
    return { ok: true, mensagem: `${n} pagamento(s) enviado(s) para aprovação do cliente.` };
  });
}

export async function acaoCancelarTitulo(clienteId: string, tituloId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("financeiro.operar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => cancelarTitulo(tx, autorDe(a), clienteId, tituloId, texto(f, "motivo")));
    rev(clienteId);
    return { ok: true, mensagem: "Título cancelado." };
  });
}

export async function acaoAnexo(clienteId: string, tituloId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("financeiro.operar", f, async (a) => {
    const arq = f.get("arquivo");
    if (!(arq instanceof File) || arq.size === 0) throw new ErroDeNegocio("Escolha o arquivo.");
    await comEscritorio(a.ctx, async (tx) => {
      const t = await tx.tituloFinanceiro.findFirst({ where: { id: tituloId, clienteId } });
      if (!t) throw new ErroDeNegocio("Título não encontrado.");
      const cat = (await tx.categoriaDocumento.findFirst({ where: { nome: "Comprovantes financeiros" } }))
        ?? (await tx.categoriaDocumento.create({ data: { escritorioId: a.usuario.escritorioId, nome: "Comprovantes financeiros" } }));
      const doc = await enviarDocumento(tx, autorDe(a), clienteId, { categoriaId: cat.id, titulo: `${t.descricao}: ${arq.name}`.slice(0, 200), arquivo: { nome: arq.name, tipo: arq.type, conteudo: Buffer.from(await arq.arrayBuffer()) } });
      await tx.documento.update({ where: { id: doc.id }, data: { tituloFinanceiroId: t.id } });
    }, { timeout: T });
    rev(clienteId);
    return { ok: true, mensagem: "Anexo enviado." };
  });
}

export async function acaoNovaConta(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("financeiro.config", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => criarContaBancaria(tx, autorDe(a), clienteId, {
      nome: texto(f, "nome"), tipo: texto(f, "tipo") as TipoContaBancaria, bancoCodigo: texto(f, "bancoCodigo"), agencia: texto(f, "agencia"), numero: texto(f, "numero"),
      saldoInicial: texto(f, "saldoInicial"), dataSaldoInicial: texto(f, "dataSaldoInicial"), contaContabilId: texto(f, "contaContabilId") || undefined,
    }));
    rev(clienteId);
    return { ok: true, mensagem: "Conta cadastrada." };
  });
}

export async function acaoTransferencia(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("financeiro.operar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => criarTransferencia(tx, autorDe(a), clienteId, { origemId: texto(f, "origemId"), destinoId: texto(f, "destinoId"), data: texto(f, "data"), valor: texto(f, "valor"), descricao: texto(f, "descricao") }));
    rev(clienteId);
    return { ok: true, mensagem: "Transferência registrada." };
  });
}

export async function acaoImportarOfx(clienteId: string, contaId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  let destino = "";
  const r = await executar("financeiro.operar", f, async (a) => {
    const arq = f.get("arquivo");
    if (!(arq instanceof File) || arq.size === 0) throw new ErroDeNegocio("Escolha o arquivo OFX.");
    const conteudo = Buffer.from(await arq.arrayBuffer());
    const res = await comEscritorio(a.ctx, async (tx) => {
      const i = await importarExtrato(tx, autorDe(a), clienteId, contaId, { nome: arq.name, conteudo });
      const s = await sugerir(tx, autorDe(a), clienteId, contaId);
      return { ...i, ...s };
    }, { timeout: 120000 });
    const mes = (await comEscritorio(a.ctx, (tx) => tx.transacaoBancaria.findFirst({ where: { extratoId: res.extratoId }, orderBy: { data: "desc" } })))?.data.toISOString().slice(0, 7);
    destino = `/financeiro/${clienteId}/conciliacao?conta=${contaId}${mes ? `&mes=${mes}` : ""}&importado=${res.novas}-${res.repetidas}-${res.automaticas}`;
  });
  if (destino) redirect(destino);
  return r;
}

export async function acaoSugerir(clienteId: string, contaId: string, _: EstadoForm): Promise<EstadoForm> {
  return executar("financeiro.operar", null, async (a) => {
    const s = await comEscritorio(a.ctx, (tx) => sugerir(tx, autorDe(a), clienteId, contaId), { timeout: 120000 });
    rev(clienteId);
    return { ok: true, mensagem: `${s.automaticas} conciliada(s) automaticamente, ${s.sugeridas} com sugestão para conferir.` };
  });
}

export async function acaoAplicarRegras(clienteId: string, contaId: string, _: EstadoForm): Promise<EstadoForm> {
  return executar("financeiro.operar", null, async (a) => {
    const n = await comEscritorio(a.ctx, (tx) => aplicarRegras(tx, autorDe(a), clienteId, contaId), { timeout: 120000 });
    rev(clienteId);
    return { ok: true, mensagem: `${n} transação(ões) lançada(s) e conciliada(s) pelas regras.` };
  });
}

export async function acaoConciliar(clienteId: string, contaId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("financeiro.operar", f, async (a) => {
    const ajuste = texto(f, "ajuste");
    await comEscritorio(a.ctx, (tx) => conciliar(tx, autorDe(a), clienteId, contaId, {
      transacoes: f.getAll("transacoes").map(String), parcelas: f.getAll("parcelas").map(String), transferencias: f.getAll("transferencias").map(String),
    }, { ajuste: ajuste === "juros" || ajuste === "desconto" ? ajuste : undefined }), { timeout: T });
    rev(clienteId);
    return { ok: true, mensagem: "Conciliado." };
  });
}

export async function acaoAceitarSugestao(clienteId: string, contaId: string, transacaoId: string, tipo: string, id: string, _: EstadoForm): Promise<EstadoForm> {
  return executar("financeiro.operar", null, async (a) => {
    await comEscritorio(a.ctx, (tx) => conciliar(tx, autorDe(a), clienteId, contaId, { transacoes: [transacaoId], parcelas: tipo === "parcela" ? [id] : [], transferencias: tipo === "transferencia" ? [id] : [] }), { timeout: T });
    rev(clienteId);
    return { ok: true, mensagem: "Conciliado." };
  });
}

export async function acaoLancarDaTransacao(clienteId: string, transacaoId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("financeiro.operar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => lancarDaTransacao(tx, autorDe(a), clienteId, transacaoId, {
      categoriaId: texto(f, "categoriaId"), descricao: texto(f, "descricao"), favorecido: texto(f, "favorecido"), criarRegra: texto(f, "criarRegra") === "sim",
    }), { timeout: T });
    rev(clienteId);
    return { ok: true, mensagem: "Lançado e conciliado." };
  });
}

export async function acaoIgnorar(clienteId: string, transacaoId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("financeiro.operar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => ignorarTransacao(tx, autorDe(a), clienteId, transacaoId, texto(f, "justificativa")));
    rev(clienteId);
    return { ok: true, mensagem: "Transação ignorada." };
  });
}

export async function acaoReativar(clienteId: string, transacaoId: string, _: EstadoForm): Promise<EstadoForm> {
  return executar("financeiro.operar", null, async (a) => {
    await comEscritorio(a.ctx, (tx) => reativarTransacao(tx, autorDe(a), clienteId, transacaoId));
    rev(clienteId);
    return { ok: true };
  });
}

export async function acaoDesfazer(clienteId: string, conciliacaoId: string, _: EstadoForm): Promise<EstadoForm> {
  return executar("financeiro.operar", null, async (a) => {
    await comEscritorio(a.ctx, (tx) => desfazerConciliacao(tx, autorDe(a), clienteId, conciliacaoId));
    rev(clienteId);
    return { ok: true, mensagem: "Conciliação desfeita." };
  });
}

export async function acaoFecharConciliacao(clienteId: string, contaId: string, mes: string, _: EstadoForm): Promise<EstadoForm> {
  return executar("financeiro.operar", null, async (a) => {
    await comEscritorio(a.ctx, (tx) => fecharConciliacao(tx, autorDe(a), clienteId, contaId, lerCompetencia(mes)), { timeout: T });
    rev(clienteId);
    return { ok: true, mensagem: "Conciliação do mês fechada." };
  });
}

export async function acaoReabrirConciliacao(clienteId: string, contaId: string, mes: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("financeiro.ver", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => reabrirConciliacao(tx, autorDe(a), clienteId, contaId, lerCompetencia(mes), texto(f, "justificativa")));
    rev(clienteId);
    return { ok: true, mensagem: "Conciliação reaberta." };
  });
}

export async function acaoCategoriasPadrao(clienteId: string, _: EstadoForm): Promise<EstadoForm> {
  return executar("financeiro.config", null, async (a) => {
    await comEscritorio(a.ctx, (tx) => garantirCategoriasPadrao(tx, autorDe(a), clienteId), { timeout: T });
    rev(clienteId);
    return { ok: true, mensagem: "Categorias criadas." };
  });
}

export async function acaoNovaCategoria(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("financeiro.config", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => criarCategoria(tx, autorDe(a), clienteId, { nome: texto(f, "nome"), paiId: texto(f, "paiId") || undefined, tipo: (texto(f, "tipo") || undefined) as "RECEITA" | "DESPESA" | undefined }));
    rev(clienteId);
    return { ok: true, mensagem: "Categoria criada." };
  });
}

export async function acaoAtualizarCategoria(clienteId: string, categoriaId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("financeiro.config", f, async (a) => {
    await comEscritorio(a.ctx, async (tx) => {
      const c = await tx.categoriaFinanceira.findFirst({ where: { id: categoriaId, clienteId } });
      if (!c) throw new ErroDeNegocio("Categoria não encontrada.");
      const conta = texto(f, "contaContabilId");
      if (conta && !(await tx.contaContabil.findFirst({ where: { id: conta, plano: { clienteId }, analitica: true } }))) throw new ErroDeNegocio("Conta contábil inválida.");
      const especial = texto(f, "especial");
      await tx.categoriaFinanceira.update({
        where: { id: c.id },
        data: { nome: texto(f, "nome") || c.nome, contaContabilId: conta || null, ativa: texto(f, "ativa") !== "nao", especial: ["PRO_LABORE", "DISTRIBUICAO_LUCROS"].includes(especial) ? (especial as "PRO_LABORE") : "NENHUMA" },
      });
    });
    rev(clienteId);
    return { ok: true, mensagem: "Categoria atualizada." };
  });
}

export async function acaoNovoCentro(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("financeiro.config", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => criarCentroDeCusto(tx, autorDe(a), clienteId, texto(f, "nome")));
    rev(clienteId);
    return { ok: true, mensagem: "Centro de custo criado." };
  });
}

export async function acaoConfig(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("financeiro.config", f, async (a) => {
    await comEscritorio(a.ctx, async (tx) => {
      if (!(await obterClienteVisivel(tx, autorDe(a), clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
      const contas = ["contaFornecedoresId", "contaClientesId", "contaJurosPagosId", "contaJurosRecebidosId", "contaDescontosConcedidosId", "contaDescontosObtidosId"] as const;
      const dados: Record<string, string | number | null> = {};
      for (const c of contas) {
        const v = texto(f, c);
        if (v && !(await tx.contaContabil.findFirst({ where: { id: v, plano: { clienteId }, analitica: true } }))) throw new ErroDeNegocio("Conta contábil inválida.");
        dados[c] = v || null;
      }
      const tolerancia = Number(texto(f, "toleranciaDias"));
      const limite = Number(texto(f, "limiteAutomatico"));
      if (!Number.isInteger(tolerancia) || tolerancia < 0 || tolerancia > 30) throw new ErroDeNegocio("Tolerância: de 0 a 30 dias.");
      if (!Number.isInteger(limite) || limite < 0 || limite > 101) throw new ErroDeNegocio("Limite: de 0 a 101.");
      await tx.configFinanceira.upsert({
        where: { clienteId },
        create: { clienteId, escritorioId: a.usuario.escritorioId, toleranciaDias: tolerancia, limiteAutomatico: limite, ...dados },
        update: { toleranciaDias: tolerancia, limiteAutomatico: limite, ...dados },
      });
    });
    rev(clienteId);
    return { ok: true, mensagem: "Configuração salva." };
  });
}

export async function acaoSincronizar(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("contabil.lancar", f, async (a) => {
    const r = await comEscritorio(a.ctx, (tx) => sincronizarContabil(tx, autorDe(a), clienteId, lerCompetencia(texto(f, "mes"))), { timeout: 120000 });
    rev(clienteId);
    revalidatePath(`/contabilidade/${clienteId}`, "layout");
    return {
      ok: r.pendencias.length === 0,
      mensagem: `${r.criados} lançamento(s) contábil(eis) criado(s), ${r.estornados} estorno(s).${r.pendencias.length ? ` Pendências: ${r.pendencias.join(" ")}` : ""}`,
    };
  });
}

export async function acaoChecklistBpo(clienteId: string, itemId: string, concluir: boolean) {
  const a = await acessoParaAcao("financeiro.operar");
  if (!a) return;
  await comEscritorio(a.ctx, async (tx) => {
    if (!(await obterClienteVisivel(tx, autorDe(a), clienteId))) return;
    await tx.itemChecklistBpo.updateMany({ where: { id: itemId, clienteId }, data: concluir ? { concluidoEm: new Date(), concluidoPorId: a.usuario.id } : { concluidoEm: null, concluidoPorId: null } });
  });
  rev(clienteId);
}
