import "server-only";
import { notFound } from "next/navigation";
import type { Tx } from "@/lib/db";
import type { Acesso } from "@/lib/auth/sessao";
import { obterClienteVisivel } from "@/lib/clientes";

export const autorDoAcesso = (a: Acesso) => ({ id: a.usuario.id, escritorioId: a.usuario.escritorioId, perfil: a.usuario.perfil });

/** Cliente visível para o usuário ou 404. */
export async function clienteOu404(tx: Tx, a: Acesso, clienteId: string) {
  const c = await obterClienteVisivel(tx, autorDoAcesso(a), clienteId);
  if (!c) notFound();
  return c;
}
