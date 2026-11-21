// Relatórios gerenciais do BPO, no mesmo formato de tabela dos contábeis
// (mesma tela e mesmas exportações PDF, XLSX e CSV).
import type { Tx } from "@/lib/db";
import { formatarData, isoData } from "@/lib/br";
import type { Linha, Tabela } from "@/lib/contabil/relatorios";
import { ratear } from "./integracao";
import { saldoDaConta } from "./financeiro";

export const TIPOS_RELATORIO_FIN = {
  realizado: "Fluxo de caixa realizado",
  projetado: "Fluxo de caixa projetado",
  dre: "DRE gerencial",
  aging: "Contas vencidas e a vencer",
  centros: "Resultado por centro de custo",
  comparativo: "Comparativo mensal",
} as const;
export type TipoRelatorioFin = keyof typeof TIPOS_RELATORIO_FIN;

async function categorias(tx: Tx, clienteId: string) {
  const cs = await tx.categoriaFinanceira.findMany({ where: { clienteId }, orderBy: { ordem: "asc" } });
  const porId = new Map(cs.map((c) => [c.id, c]));
  const grupoDe = (id: string) => {
    const c = porId.get(id)!;
    return c.paiId ? porId.get(c.paiId)! : c;
  };
  return { cs, porId, grupoDe };
}

/** Tabela por grupo e categoria a partir de valores já somados por categoria (positivo = entrada/receita). */
function arvoreCategorias(cs: { id: string; nome: string; paiId: string | null; tipo: string; ordem: number }[], valores: Map<string, bigint>, rotuloTotal: string): { linhas: Linha[]; receitas: bigint; despesas: bigint } {
  const linhas: Linha[] = [];
  let receitas = 0n, despesas = 0n;
  for (const tipo of ["RECEITA", "DESPESA"] as const) {
    let totalTipo = 0n;
    const grupos = cs.filter((c) => !c.paiId && c.tipo === tipo);
    const blocos: Linha[] = [];
    for (const g of grupos) {
      const filhas = cs.filter((c) => c.paiId === g.id && valores.get(c.id));
      const tg = filhas.reduce((a, c) => a + valores.get(c.id)!, 0n);
      if (!filhas.length) continue;
      blocos.push({ celulas: [g.nome, tg], destaque: "subtotal" });
      for (const f of filhas) blocos.push({ celulas: [f.nome, valores.get(f.id)!], nivel: 1 });
      totalTipo += tg;
    }
    linhas.push({ celulas: [tipo === "RECEITA" ? "Receitas" : "Despesas", totalTipo], destaque: "grupo" }, ...blocos);
    if (tipo === "RECEITA") receitas = totalTipo;
    else despesas = totalTipo;
  }
  linhas.push({ celulas: [rotuloTotal, receitas + despesas], destaque: "total" });
  return { linhas, receitas, despesas };
}

/** Fluxo realizado: baixas do período por categoria (rateadas), juros e descontos à parte. */
export async function fluxoRealizado(tx: Tx, clienteId: string, de: Date, ate: Date): Promise<Tabela> {
  const { cs } = await categorias(tx, clienteId);
  const baixas = await tx.parcela.findMany({ where: { clienteId, situacao: "BAIXADA", dataBaixa: { gte: de, lte: ate } }, include: { titulo: { include: { rateios: true } } } });
  const valores = new Map<string, bigint>();
  let juros = 0n, descontos = 0n;
  for (const p of baixas) {
    const sinal = p.titulo.tipo === "RECEBER" ? 1n : -1n;
    const partes = ratear(p.valorCentavos, p.titulo.rateios.map((r) => r.valorCentavos));
    p.titulo.rateios.forEach((r, i) => valores.set(r.categoriaId, (valores.get(r.categoriaId) ?? 0n) + sinal * partes[i]));
    juros += sinal * (p.jurosCentavos + p.multaCentavos);
    descontos += -sinal * p.descontoCentavos;
  }
  const contas = await tx.contaBancaria.findMany({ where: { clienteId } });
  const vespera = new Date(de.getTime() - 86400_000);
  let inicial = 0n, final = 0n;
  for (const c of contas) {
    // Conta aberta dentro do período: o saldo de abertura entra no saldo inicial.
    const abertaNoPeriodo = c.dataSaldoInicial >= de && c.dataSaldoInicial <= ate;
    inicial += abertaNoPeriodo ? c.saldoInicialCentavos : await saldoDaConta(tx, c.id, vespera);
    final += await saldoDaConta(tx, c.id, ate);
  }
  const a = arvoreCategorias(cs, valores, "Resultado de caixa das categorias");
  const linhas: Linha[] = [{ celulas: ["Saldo inicial das contas", inicial], destaque: "subtotal" }, ...a.linhas];
  if (juros) linhas.push({ celulas: ["Juros e multas (recebidos − pagos)", juros], nivel: 1 });
  if (descontos) linhas.push({ celulas: ["Descontos (obtidos − concedidos)", descontos], nivel: 1 });
  linhas.push({ celulas: ["Saldo final das contas", final], destaque: "total" });
  const fecha = inicial + a.receitas + a.despesas + juros + descontos === final;
  return {
    titulo: "Fluxo de caixa realizado",
    colunas: [{ rotulo: "Categoria", largura: 4 }, { rotulo: "Valor", valor: true, largura: 1.5 }],
    linhas,
    alerta: fecha ? undefined : "O saldo final não bate com as baixas. Há saldo inicial de conta ou transferência fora do período; confira as contas.",
    notas: ["Saídas aparecem negativas. Transferências entre contas não entram nas categorias."],
  };
}

/** Fluxo projetado: saldo de hoje + parcelas em aberto por vencimento. */
export async function fluxoProjetado(tx: Tx, clienteId: string, hoje: Date, ate: Date): Promise<Tabela> {
  const contas = await tx.contaBancaria.findMany({ where: { clienteId, ativa: true } });
  let saldo = 0n;
  for (const c of contas) saldo += await saldoDaConta(tx, c.id, hoje);
  const abertas = await tx.parcela.findMany({
    where: { clienteId, situacao: { in: ["ABERTA", "AGUARDANDO_APROVACAO", "APROVADA", "REPROVADA"] }, vencimento: { lte: ate }, titulo: { canceladoEm: null } },
    include: { titulo: { include: { favorecido: true } } }, orderBy: [{ vencimento: "asc" }],
  });
  const linhas: Linha[] = [{ celulas: [formatarData(hoje), "Saldo atual das contas", null, null, saldo], destaque: "subtotal" }];
  for (const p of abertas) {
    const entrada = p.titulo.tipo === "RECEBER";
    saldo += entrada ? p.valorCentavos : -p.valorCentavos;
    const atrasada = p.vencimento < hoje;
    linhas.push({ celulas: [formatarData(p.vencimento) + (atrasada ? " (vencida)" : ""), `${p.titulo.descricao}${p.titulo.favorecido ? ` · ${p.titulo.favorecido.nome}` : ""}`, entrada ? p.valorCentavos : null, entrada ? null : p.valorCentavos, saldo] });
  }
  linhas.push({ celulas: [formatarData(ate), "Saldo projetado", null, null, saldo], destaque: "total" });
  return {
    titulo: "Fluxo de caixa projetado",
    colunas: [{ rotulo: "Vencimento", largura: 1.3 }, { rotulo: "Descrição", largura: 3.5 }, { rotulo: "Entradas", valor: true }, { rotulo: "Saídas", valor: true }, { rotulo: "Saldo previsto", valor: true }],
    linhas,
    notas: ["Inclui parcelas vencidas ainda não baixadas."],
  };
}

/** DRE gerencial pelo regime de competência (data de competência dos títulos). */
export async function dreGerencial(tx: Tx, clienteId: string, de: Date, ate: Date): Promise<Tabela> {
  const { cs } = await categorias(tx, clienteId);
  const rateios = await tx.rateioTitulo.findMany({ where: { titulo: { clienteId, canceladoEm: null, competencia: { gte: de, lte: ate } } }, include: { titulo: { select: { tipo: true } } } });
  const valores = new Map<string, bigint>();
  for (const r of rateios) valores.set(r.categoriaId, (valores.get(r.categoriaId) ?? 0n) + (r.titulo.tipo === "RECEBER" ? r.valorCentavos : -r.valorCentavos));
  const a = arvoreCategorias(cs, valores, "Resultado do período");
  return { titulo: "DRE gerencial", colunas: [{ rotulo: "Categoria", largura: 4 }, { rotulo: "Valor", valor: true, largura: 1.5 }], linhas: a.linhas, notas: ["Pela competência dos títulos. Despesas aparecem negativas."] };
}

export async function aging(tx: Tx, clienteId: string, hoje: Date): Promise<Tabela> {
  const ps = await tx.parcela.findMany({ where: { clienteId, situacao: { in: ["ABERTA", "AGUARDANDO_APROVACAO", "APROVADA", "REPROVADA"] }, titulo: { canceladoEm: null } }, include: { titulo: true } });
  const faixas: [string, (d: number) => boolean][] = [
    ["Vencidas há mais de 90 dias", (d) => d < -90], ["Vencidas de 61 a 90 dias", (d) => d >= -90 && d < -60], ["Vencidas de 31 a 60 dias", (d) => d >= -60 && d < -30],
    ["Vencidas de 1 a 30 dias", (d) => d >= -30 && d < 0], ["Vencem em até 30 dias", (d) => d >= 0 && d <= 30], ["Vencem de 31 a 60 dias", (d) => d > 30 && d <= 60], ["Vencem depois de 60 dias", (d) => d > 60],
  ];
  const linhas: Linha[] = faixas.map(([rotulo, f]) => {
    const dentro = ps.filter((p) => f(Math.round((p.vencimento.getTime() - hoje.getTime()) / 86400_000)));
    const soma = (t: string) => dentro.filter((p) => p.titulo.tipo === t).reduce((a, p) => a + p.valorCentavos, 0n);
    return { celulas: [rotulo, soma("RECEBER"), soma("PAGAR"), String(dentro.length)] };
  });
  const tot = (t: string) => ps.filter((p) => p.titulo.tipo === t).reduce((a, p) => a + p.valorCentavos, 0n);
  linhas.push({ celulas: ["Total em aberto", tot("RECEBER"), tot("PAGAR"), String(ps.length)], destaque: "total" });
  return { titulo: "Contas vencidas e a vencer", colunas: [{ rotulo: "Faixa", largura: 3 }, { rotulo: "A receber", valor: true }, { rotulo: "A pagar", valor: true }, { rotulo: "Parcelas", valor: true, largura: 0.8 }], linhas, notas: [`Posição em ${formatarData(hoje)}.`] };
}

export async function porCentroDeCusto(tx: Tx, clienteId: string, de: Date, ate: Date): Promise<Tabela> {
  const centros = await tx.centroDeCusto.findMany({ where: { clienteId }, orderBy: { nome: "asc" } });
  const rateios = await tx.rateioTitulo.findMany({ where: { titulo: { clienteId, canceladoEm: null, competencia: { gte: de, lte: ate } } }, include: { titulo: { select: { tipo: true } } } });
  const linhas: Linha[] = [...centros.map((c) => ({ id: c.id, nome: c.nome })), { id: null, nome: "Sem centro de custo" }].map(({ id, nome }) => {
    const rs = rateios.filter((r) => r.centroCustoId === id);
    const rec = rs.filter((r) => r.titulo.tipo === "RECEBER").reduce((a, r) => a + r.valorCentavos, 0n);
    const desp = rs.filter((r) => r.titulo.tipo === "PAGAR").reduce((a, r) => a + r.valorCentavos, 0n);
    return { celulas: [nome, rec, desp, rec - desp] } as Linha;
  }).filter((l) => l.celulas[1] !== 0n || l.celulas[2] !== 0n);
  return { titulo: "Resultado por centro de custo", colunas: [{ rotulo: "Centro de custo", largura: 3 }, { rotulo: "Receitas", valor: true }, { rotulo: "Despesas", valor: true }, { rotulo: "Resultado", valor: true }], linhas, notas: ["Pela competência dos títulos."] };
}

/** Comparativo mês a mês (até 12 meses) por grupo de categorias, pela competência. */
export async function comparativoMensal(tx: Tx, clienteId: string, de: Date, ate: Date): Promise<Tabela> {
  const { cs, grupoDe } = await categorias(tx, clienteId);
  const meses: Date[] = [];
  for (let d = new Date(Date.UTC(de.getUTCFullYear(), de.getUTCMonth(), 1)); d <= ate && meses.length < 12; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) meses.push(d);
  const rateios = await tx.rateioTitulo.findMany({ where: { titulo: { clienteId, canceladoEm: null, competencia: { gte: meses[0], lte: ate } } }, include: { titulo: { select: { tipo: true, competencia: true } } } });
  const chave = (d: Date) => isoData(d).slice(0, 7);
  const grupos = cs.filter((c) => !c.paiId);
  const tabela = new Map<string, Map<string, bigint>>();
  for (const r of rateios) {
    const g = grupoDe(r.categoriaId).id;
    const m = tabela.get(g) ?? new Map();
    const k = chave(r.titulo.competencia);
    m.set(k, (m.get(k) ?? 0n) + (r.titulo.tipo === "RECEBER" ? r.valorCentavos : -r.valorCentavos));
    tabela.set(g, m);
  }
  const linhas: Linha[] = grupos.filter((g) => tabela.has(g.id)).map((g) => ({ celulas: [g.nome, ...meses.map((m) => tabela.get(g.id)!.get(chave(m)) ?? 0n)], destaque: undefined }));
  linhas.push({ celulas: ["Resultado", ...meses.map((m) => [...tabela.values()].reduce((a, v) => a + (v.get(chave(m)) ?? 0n), 0n))], destaque: "total" });
  return {
    titulo: "Comparativo mensal",
    colunas: [{ rotulo: "Grupo", largura: 2.5 }, ...meses.map((m) => ({ rotulo: `${String(m.getUTCMonth() + 1).padStart(2, "0")}/${m.getUTCFullYear()}`, valor: true, largura: 1 }))],
    linhas, notas: ["Pela competência. Despesas negativas. Até 12 meses."],
  };
}
