import type { Tx } from "@/lib/db";
import { ordenarContas } from "./plano";

/** Contas analíticas e ativas do cliente, para o campo de conta do lançamento. */
export async function contasParaLancar(tx: Tx, clienteId: string) {
  const contas = await tx.contaContabil.findMany({ where: { plano: { clienteId }, analitica: true, ativa: true }, select: { codigo: true, nome: true } });
  return ordenarContas(contas);
}
