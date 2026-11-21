import type { SituacaoCliente, SituacaoImportacao } from "@prisma/client";
import { NOME_SITUACAO } from "@/lib/clientes";

const COR: Record<SituacaoCliente, string> = { EM_ENTRADA: "atencao", ATIVO: "positivo", SUSPENSO: "atencao", ENCERRADO: "neutro" };

/** Status sempre com texto, nunca só cor (brandbook: "Status sempre acompanhado de texto"). */
export function SeloSituacao({ situacao }: { situacao: SituacaoCliente }) {
  return <span className={`selo ${COR[situacao]}`}>{NOME_SITUACAO[situacao]}</span>;
}

export function Selo({ tom, children }: { tom: "positivo" | "atencao" | "erro" | "neutro"; children: React.ReactNode }) {
  return <span className={`selo ${tom}`}>{children}</span>;
}

export const SITUACAO_IMP: Record<SituacaoImportacao, [string, "positivo" | "atencao" | "erro" | "neutro"]> = {
  RECEBIDA: ["Recebida", "neutro"], VALIDANDO: ["Validando", "neutro"], COM_ERROS: ["Com erros", "erro"],
  PRONTA: ["Pronta para aplicar", "atencao"], APLICADA: ["Aplicada", "positivo"], CANCELADA: ["Cancelada", "neutro"],
};
