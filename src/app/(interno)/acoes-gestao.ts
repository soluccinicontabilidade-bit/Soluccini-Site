"use server";

import { revalidatePath } from "next/cache";
import type { RecorrenciaTarefa } from "@prisma/client";
import { comEscritorio } from "@/lib/db";
import { acessoParaAcao, type Acesso } from "@/lib/auth/sessao";
import type { Acao } from "@/lib/auth/permissoes";
import { estadoDeErro, SEM_PERMISSAO, texto, type EstadoForm } from "@/lib/form";
import { concluirTarefa, criarTarefa, reabrirTarefa } from "@/lib/tarefas";
import { cancelarCobranca, criarCobrancaAvulsa, gerarCobrancasDoMes, registrarPagamento, salvarConfigPix } from "@/lib/cobranca/cobrancas";
import { solicitarAceite } from "@/lib/cobranca/aceite";
import { criarAcessoPortal, criarAgendamento, removerAcessoPortal } from "@/lib/portal";
import { lerCompetencia } from "@/lib/contabil/lancamentos";

const autorDe = (a: Acesso) => ({ id: a.usuario.id, escritorioId: a.usuario.escritorioId, perfil: a.usuario.perfil });
async function executar(acao: Acao | undefined, f: FormData | null, fn: (a: Acesso) => Promise<EstadoForm | void>): Promise<EstadoForm> {
  const a = await acessoParaAcao(acao);
  if (!a) return SEM_PERMISSAO;
  try {
    return (await fn(a)) ?? { ok: true };
  } catch (e) {
    return estadoDeErro(e, f ?? undefined);
  }
}

export async function acaoNovaTarefa(_: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar(undefined, f, async (a) => {
    await comEscritorio(a.ctx, (tx) => criarTarefa(tx, autorDe(a), { titulo: texto(f, "titulo"), descricao: texto(f, "descricao"), clienteId: texto(f, "clienteId"), responsavelId: texto(f, "responsavelId"), prazo: texto(f, "prazo"), recorrencia: (texto(f, "recorrencia") || "NENHUMA") as RecorrenciaTarefa }));
    revalidatePath("/tarefas");
    return { ok: true, mensagem: "Tarefa criada." };
  });
}

export async function acaoConcluirTarefa(id: string, concluir: boolean) {
  const a = await acessoParaAcao();
  if (!a) return;
  await comEscritorio(a.ctx, (tx) => (concluir ? concluirTarefa(tx, autorDe(a), id) : reabrirTarefa(tx, autorDe(a), id)));
  revalidatePath("/tarefas");
  revalidatePath("/");
}

export async function acaoLerNotificacoes() {
  const a = await acessoParaAcao();
  if (!a) return;
  await comEscritorio(a.ctx, (tx) => tx.notificacao.updateMany({ where: { usuarioId: a.usuario.id, lidaEm: null }, data: { lidaEm: new Date() } }));
  revalidatePath("/", "layout");
}

export async function acaoGerarCobrancas(_: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("cobranca.gerenciar", f, async (a) => {
    const r = await comEscritorio(a.ctx, (tx) => gerarCobrancasDoMes(tx, autorDe(a), lerCompetencia(texto(f, "mes"))), { timeout: 120000 });
    revalidatePath("/cobrancas");
    return { ok: true, mensagem: `${r.criadas} cobrança(s) gerada(s).${r.semPix.length ? " Configure a chave Pix em Configurações para gerar o Pix copia e cola." : ""}` };
  });
}

export async function acaoCobrancaAvulsa(_: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("cobranca.gerenciar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => criarCobrancaAvulsa(tx, autorDe(a), texto(f, "clienteId"), { descricao: texto(f, "descricao"), valor: texto(f, "valor"), vencimento: texto(f, "vencimento") }));
    revalidatePath("/cobrancas");
    return { ok: true, mensagem: "Cobrança criada." };
  });
}

export async function acaoPagamento(id: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("cobranca.gerenciar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => registrarPagamento(tx, autorDe(a), id, { data: texto(f, "data"), valor: texto(f, "valor") }));
    revalidatePath("/cobrancas");
    return { ok: true, mensagem: "Pagamento registrado." };
  });
}

export async function acaoCancelarCobranca(id: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("cobranca.gerenciar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => cancelarCobranca(tx, autorDe(a), id, texto(f, "motivo")));
    revalidatePath("/cobrancas");
    return { ok: true, mensagem: "Cobrança cancelada." };
  });
}

export async function acaoConfigPix(_: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("configuracoes", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => salvarConfigPix(tx, autorDe(a), { chavePix: texto(f, "chavePix"), nomeRecebedor: texto(f, "nomeRecebedor"), cidadeRecebedor: texto(f, "cidadeRecebedor") }));
    revalidatePath("/configuracoes");
    return { ok: true, mensagem: "Recebimento por Pix configurado." };
  });
}

export async function acaoAcessoPortal(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("portal.gerenciar", f, async (a) => {
    const r = await comEscritorio(a.ctx, (tx) => criarAcessoPortal(tx, autorDe(a), clienteId, { nome: texto(f, "nome"), email: texto(f, "email"), perfil: texto(f, "perfil") }));
    revalidatePath(`/clientes/${clienteId}`);
    return { ok: true, mensagem: r.senhaTemporaria ? `Acesso criado. Senha temporária: ${r.senhaTemporaria}. Entregue por canal seguro; no primeiro acesso a pessoa ativa o código do celular.` : "Acesso liberado para o usuário existente." };
  });
}

export async function acaoRemoverAcesso(clienteId: string, usuarioId: string, _: EstadoForm): Promise<EstadoForm> {
  return executar("portal.gerenciar", null, async (a) => {
    await comEscritorio(a.ctx, (tx) => removerAcessoPortal(tx, autorDe(a), clienteId, usuarioId));
    revalidatePath(`/clientes/${clienteId}`);
    return { ok: true, mensagem: "Acesso removido." };
  });
}

export async function acaoAgendamento(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("portal.gerenciar", f, async (a) => {
    const [modulo, tipo] = texto(f, "relatorio").split(":");
    await comEscritorio(a.ctx, (tx) => criarAgendamento(tx, autorDe(a), clienteId, { modulo, tipo, dia: Number(texto(f, "dia")), destinatarios: texto(f, "destinatarios") }));
    revalidatePath(`/clientes/${clienteId}`);
    return { ok: true, mensagem: "Envio agendado." };
  });
}

export async function acaoDesativarAgendamento(clienteId: string, id: string) {
  const a = await acessoParaAcao("portal.gerenciar");
  if (!a) return;
  await comEscritorio(a.ctx, (tx) => tx.agendamentoRelatorio.updateMany({ where: { id, clienteId }, data: { ativo: false } }));
  revalidatePath(`/clientes/${clienteId}`);
}

export async function acaoSolicitarAceite(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("portal.gerenciar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => solicitarAceite(tx, autorDe(a), clienteId, texto(f, "documentoId"), texto(f, "mensagem")));
    revalidatePath(`/clientes/${clienteId}`);
    return { ok: true, mensagem: "Pedido de aceite enviado ao portal do cliente." };
  });
}
