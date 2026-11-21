import type { PerfilUsuario, RecorrenciaTarefa } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { ErroDeNegocio } from "@/lib/erros";
import { lerData } from "@/lib/br";
import { obterClienteVisivel, registrarEvento } from "@/lib/clientes";
import { somarMeses } from "@/lib/financeiro/financeiro";

interface Autor {
  id: string;
  escritorioId: string;
  perfil: PerfilUsuario;
}

export const NOME_RECORRENCIA: Record<RecorrenciaTarefa, string> = { NENHUMA: "Não repete", MENSAL: "Todo mês", ANUAL: "Todo ano" };

export async function criarTarefa(tx: Tx, autor: Autor, e: { titulo: string; descricao?: string; clienteId?: string; responsavelId?: string; prazo: string; recorrencia?: RecorrenciaTarefa }) {
  if (e.titulo.trim().length < 3) throw new ErroDeNegocio("Descreva a tarefa.");
  let prazo: Date;
  try {
    prazo = lerData(e.prazo);
  } catch {
    throw new ErroDeNegocio("Informe o prazo.");
  }
  if (e.clienteId && !(await obterClienteVisivel(tx, autor, e.clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  if (e.responsavelId && !(await tx.usuario.findFirst({ where: { id: e.responsavelId, ativo: true } }))) throw new ErroDeNegocio("Responsável inválido.");
  return tx.tarefa.create({
    data: {
      escritorioId: autor.escritorioId, titulo: e.titulo.trim(), descricao: e.descricao?.trim() || null, clienteId: e.clienteId || null,
      responsavelId: e.responsavelId || null, prazo, recorrencia: e.recorrencia ?? "NENHUMA", criadoPorId: autor.id,
    },
  });
}

/** Conclui; se for recorrente, cria a próxima ocorrência (uma única vez). */
export async function concluirTarefa(tx: Tx, autor: Autor, id: string) {
  const t = await tx.tarefa.findUnique({ where: { id } });
  if (!t) throw new ErroDeNegocio("Tarefa não encontrada.");
  if (t.clienteId && !(await obterClienteVisivel(tx, autor, t.clienteId))) throw new ErroDeNegocio("Tarefa não encontrada.");
  if (t.concluidaEm) return;
  await tx.tarefa.update({ where: { id }, data: { concluidaEm: new Date(), concluidaPorId: autor.id } });
  if (t.recorrencia !== "NENHUMA" && !(await tx.tarefa.findUnique({ where: { anteriorId: t.id } }))) {
    await tx.tarefa.create({
      data: {
        escritorioId: t.escritorioId, titulo: t.titulo, descricao: t.descricao, clienteId: t.clienteId, responsavelId: t.responsavelId,
        prazo: somarMeses(t.prazo, t.recorrencia === "MENSAL" ? 1 : 12), recorrencia: t.recorrencia, anteriorId: t.id, criadoPorId: autor.id,
      },
    });
  }
  if (t.clienteId) await registrarEvento(tx, autor, t.clienteId, "tarefa.concluida", `Tarefa concluída: ${t.titulo}`);
}

export async function reabrirTarefa(tx: Tx, autor: Autor, id: string) {
  const t = await tx.tarefa.findUnique({ where: { id } });
  if (!t) throw new ErroDeNegocio("Tarefa não encontrada.");
  if (t.clienteId && !(await obterClienteVisivel(tx, autor, t.clienteId))) throw new ErroDeNegocio("Tarefa não encontrada.");
  await tx.tarefa.update({ where: { id }, data: { concluidaEm: null, concluidaPorId: null } });
}

/** Avisa a pessoa (uma vez por chave). */
export async function notificar(tx: Tx, escritorioId: string, usuarioId: string, titulo: string, chave: string, link?: string) {
  await tx.notificacao.upsert({
    where: { usuarioId_chave: { usuarioId, chave } },
    create: { escritorioId, usuarioId, titulo, chave, link },
    update: {},
  });
}
