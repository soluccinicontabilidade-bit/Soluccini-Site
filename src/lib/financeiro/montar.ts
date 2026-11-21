import type { Tx } from "@/lib/db";
import { formatarData, hojeSaoPaulo, lerData } from "@/lib/br";
import { ErroDeNegocio } from "@/lib/erros";
import type { Tabela } from "@/lib/contabil/relatorios";
import { aging, comparativoMensal, dreGerencial, fluxoProjetado, fluxoRealizado, porCentroDeCusto, TIPOS_RELATORIO_FIN, type TipoRelatorioFin } from "./relatorios";

export function lerPedidoFin(p: Record<string, string | undefined>, de: string, ate: string) {
  const tipo = (Object.keys(TIPOS_RELATORIO_FIN) as TipoRelatorioFin[]).includes(p.tipo as TipoRelatorioFin) ? (p.tipo as TipoRelatorioFin) : "realizado";
  return { tipo, de: p.de || de, ate: p.ate || ate };
}

export async function montarRelatorioFin(tx: Tx, clienteId: string, p: { tipo: TipoRelatorioFin; de: string; ate: string }): Promise<{ tabela: Tabela; periodo: string }> {
  let de: Date, ate: Date;
  try {
    de = lerData(p.de);
    ate = lerData(p.ate);
  } catch {
    throw new ErroDeNegocio("Datas inválidas.");
  }
  if (de > ate) throw new ErroDeNegocio("A data inicial é depois da final.");
  const hoje = hojeSaoPaulo();
  const periodo = `${formatarData(de)} a ${formatarData(ate)}`;
  switch (p.tipo) {
    case "realizado": return { tabela: await fluxoRealizado(tx, clienteId, de, ate), periodo };
    case "projetado": return { tabela: await fluxoProjetado(tx, clienteId, hoje, ate), periodo: `De ${formatarData(hoje)} a ${formatarData(ate)}` };
    case "dre": return { tabela: await dreGerencial(tx, clienteId, de, ate), periodo };
    case "aging": return { tabela: await aging(tx, clienteId, hoje), periodo: `Posição em ${formatarData(hoje)}` };
    case "centros": return { tabela: await porCentroDeCusto(tx, clienteId, de, ate), periodo };
    case "comparativo": return { tabela: await comparativoMensal(tx, clienteId, de, ate), periodo };
  }
}
