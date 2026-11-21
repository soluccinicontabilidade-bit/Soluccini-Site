import type { Tx } from "@/lib/db";
import { formatarData, lerData } from "@/lib/br";
import { ErroDeNegocio } from "@/lib/erros";
import { balancete, balanco, diario, dre, fluxoDeCaixa, razao, type Tabela } from "./relatorios";
import { carregarBase } from "./periodos";

export const TIPOS_RELATORIO = {
  balancete: "Balancete",
  dre: "DRE",
  balanco: "Balanço patrimonial",
  fluxo: "Fluxo de caixa",
  razao: "Razão",
  diario: "Diário",
} as const;
export type TipoRelatorio = keyof typeof TIPOS_RELATORIO;

export interface PedidoRelatorio {
  tipo: TipoRelatorio;
  de: string;
  ate: string;
  nivel: number;
  contaId?: string;
}

export function lerPedido(p: Record<string, string | undefined>, padraoDe: string, padraoAte: string): PedidoRelatorio {
  const tipo = (Object.keys(TIPOS_RELATORIO) as TipoRelatorio[]).includes(p.tipo as TipoRelatorio) ? (p.tipo as TipoRelatorio) : "balancete";
  const nivel = Math.min(Math.max(Number(p.nivel) || 4, 1), 9);
  return { tipo, de: p.de || padraoDe, ate: p.ate || padraoAte, nivel, contaId: p.conta || undefined };
}

/** Monta o relatório pedido. Devolve a tabela e o texto do período para o cabeçalho. */
export async function montarRelatorio(tx: Tx, clienteId: string, pedido: PedidoRelatorio): Promise<{ tabela: Tabela; periodo: string }> {
  let de: Date, ate: Date;
  try {
    de = lerData(pedido.de);
    ate = lerData(pedido.ate);
  } catch {
    throw new ErroDeNegocio("Datas inválidas.");
  }
  if (de > ate) throw new ErroDeNegocio("A data inicial é depois da final.");
  if (ate.getTime() - de.getTime() > 366 * 5 * 86400_000) throw new ErroDeNegocio("Escolha um intervalo de até 5 anos.");
  const { contas, partidas } = await carregarBase(tx, clienteId, ate);
  const periodo = `${formatarData(de)} a ${formatarData(ate)}`;
  switch (pedido.tipo) {
    case "balancete": return { tabela: balancete(contas, partidas, de, ate), periodo };
    case "dre": return { tabela: dre(contas, partidas, de, ate, pedido.nivel), periodo };
    case "balanco": return { tabela: balanco(contas, partidas, ate, pedido.nivel), periodo: `Posição em ${formatarData(ate)}` };
    case "fluxo": return { tabela: fluxoDeCaixa(contas, partidas, de, ate), periodo };
    case "razao": return { tabela: razao(contas, partidas, de, ate, pedido.contaId ? [pedido.contaId] : undefined), periodo };
    case "diario": return { tabela: diario(contas, partidas, de, ate), periodo };
  }
}
