"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { CategoriaItemIRPF, ModeloDeclaracao, SituacaoDeclaracao, SituacaoItemIRPF } from "@prisma/client";
import { comEscritorio } from "@/lib/db";
import { acessoParaAcao, type Acesso } from "@/lib/auth/sessao";
import type { Acao } from "@/lib/auth/permissoes";
import { ErroDeNegocio } from "@/lib/erros";
import { estadoDeErro, SEM_PERMISSAO, texto, valoresDe, type EstadoForm } from "@/lib/form";
import {
  adicionarItem, anexarAoItem, atualizarDeclaracao, atualizarItem, criarDeclaracao, gerarLinkEnvio, mudarSituacaoDeclaracao, revogarLinks, salvarTabela, simular,
} from "@/lib/irpf/irpf";

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

export async function acaoNovaDeclaracao(_: EstadoForm, f: FormData): Promise<EstadoForm> {
  let destino = "";
  const r = await executar("irpf.operar", f, async (a) => {
    const [pessoaId, clienteId] = texto(f, "contribuinte").split("|");
    if (!pessoaId || !clienteId) throw new ErroDeNegocio("Escolha o contribuinte.");
    const d = await comEscritorio(a.ctx, (tx) => criarDeclaracao(tx, autorDe(a), { pessoaId, clienteId, ano: Number(texto(f, "ano")), responsavelId: texto(f, "responsavelId"), honorario: texto(f, "honorario"), prazo: texto(f, "prazo") }));
    destino = `/irpf/${d.id}`;
  });
  if (destino) redirect(destino);
  return { ...r, valores: valoresDe(f) };
}

export async function acaoSituacao(id: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("irpf.operar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => mudarSituacaoDeclaracao(tx, autorDe(a), id, {
      para: texto(f, "para") as SituacaoDeclaracao, recibo: texto(f, "recibo"), transmitidaEm: texto(f, "transmitidaEm"), resultado: texto(f, "resultado"),
      modelo: (texto(f, "modelo") || undefined) as ModeloDeclaracao | undefined, pendenciasMalha: texto(f, "pendenciasMalha"), retificar: texto(f, "retificar") === "sim",
    }));
    revalidatePath(`/irpf/${id}`);
    return { ok: true, mensagem: "Situação atualizada." };
  });
}

export async function acaoDadosDeclaracao(id: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("irpf.operar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => atualizarDeclaracao(tx, autorDe(a), id, { responsavelId: texto(f, "responsavelId"), honorario: texto(f, "honorario"), honorarioPago: texto(f, "honorarioPago") === "sim", prazo: texto(f, "prazo"), observacoes: texto(f, "observacoes") }));
    revalidatePath(`/irpf/${id}`);
    return { ok: true, mensagem: "Dados salvos." };
  });
}

export async function acaoItem(id: string, itemId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("irpf.operar", f, async (a) => {
    const arq = f.get("arquivo");
    await comEscritorio(a.ctx, async (tx) => {
      if (arq instanceof File && arq.size > 0) await anexarAoItem(tx, autorDe(a), id, itemId, { nome: arq.name, tipo: arq.type, conteudo: Buffer.from(await arq.arrayBuffer()) });
      const s = texto(f, "situacao");
      if (s) await atualizarItem(tx, autorDe(a), id, itemId, s as SituacaoItemIRPF, texto(f, "observacao"));
    }, { timeout: 60000 });
    revalidatePath(`/irpf/${id}`);
    return { ok: true };
  });
}

export async function acaoNovoItem(id: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("irpf.operar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => adicionarItem(tx, autorDe(a), id, texto(f, "categoria") as CategoriaItemIRPF, texto(f, "descricao")));
    revalidatePath(`/irpf/${id}`);
    return { ok: true };
  });
}

export async function acaoGerarLink(id: string, _: EstadoForm): Promise<EstadoForm> {
  return executar("irpf.operar", null, async (a) => {
    const token = await comEscritorio(a.ctx, (tx) => gerarLinkEnvio(tx, autorDe(a), id));
    const h = await headers();
    const base = process.env.APP_URL || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
    revalidatePath(`/irpf/${id}`);
    return { ok: true, mensagem: "Link gerado. Copie agora: por segurança ele não é mostrado de novo.", dados: { link: `${base}/enviar/${token}` } };
  });
}

export async function acaoRevogarLinks(id: string, _: EstadoForm): Promise<EstadoForm> {
  return executar("irpf.operar", null, async (a) => {
    await comEscritorio(a.ctx, (tx) => revogarLinks(tx, autorDe(a), id));
    revalidatePath(`/irpf/${id}`);
    return { ok: true, mensagem: "Links desativados." };
  });
}

export async function acaoSimular(id: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("irpf.operar", f, async (a) => {
    const campos = ["rendimentosTributaveis", "previdenciaOficial", "dependentes", "despesasMedicas", "instrucao", "pgbl", "pensaoAlimenticia", "impostoRetido", "rendimentosTotais"] as const;
    await comEscritorio(a.ctx, (tx) => simular(tx, autorDe(a), id, Object.fromEntries(campos.map((c) => [c, texto(f, c)])) as never));
    revalidatePath(`/irpf/${id}`);
    return { ok: true, mensagem: "Simulação atualizada." };
  });
}

export async function acaoTabela(ano: number, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("irpf.tabelas", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => salvarTabela(tx, autorDe(a), ano, { parametros: texto(f, "parametros"), confirmada: texto(f, "confirmada") === "sim", fonte: texto(f, "fonte"), prazoEntrega: texto(f, "prazoEntrega") }));
    revalidatePath("/irpf/tabelas");
    return { ok: true, mensagem: `Tabela de ${ano} salva.` };
  });
}
