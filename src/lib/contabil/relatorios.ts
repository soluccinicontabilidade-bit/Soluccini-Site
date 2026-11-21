// Motor dos relatórios contábeis. Funções puras sobre contas e partidas, sem
// banco: fáceis de testar. Valores em centavos (bigint). Convenção interna:
// saldo "devedor positivo" (débitos - créditos); a apresentação inverte o
// sinal conforme o grupo (passivo, PL e receitas são credores).

import type { GrupoConta, NaturezaConta, OrigemLancamento, TipoPartida } from "@prisma/client";
import { formatarData, formatarReais } from "@/lib/br";
import { compararCodigos } from "./plano";

export interface ContaR {
  id: string;
  codigo: string;
  nome: string;
  grupo: GrupoConta;
  natureza: NaturezaConta;
  analitica: boolean;
  paiId: string | null;
  nivel: number;
  disponivel: boolean;
}

export interface PartidaR {
  contaId: string;
  tipo: TipoPartida;
  valor: bigint;
  lancamentoId: string;
  numero: number;
  data: Date;
  historico: string;
  origem: OrigemLancamento;
  complemento: string | null;
}

export interface Movimento {
  anterior: bigint; // saldo antes de `de` (devedor positivo)
  debitos: bigint;
  creditos: bigint;
  final: bigint;
}

const zero = (): Movimento => ({ anterior: 0n, debitos: 0n, creditos: 0n, final: 0n });
const credor = (g: GrupoConta) => g === "PASSIVO" || g === "PATRIMONIO_LIQUIDO" || g === "RECEITA" || g === "APURACAO";

/** Saldos por conta no intervalo, acumulados das analíticas para as sintéticas. */
export function calcularSaldos(contas: ContaR[], partidas: PartidaR[], de: Date | null, ate: Date, filtro?: (p: PartidaR) => boolean): Map<string, Movimento> {
  const m = new Map<string, Movimento>(contas.map((c) => [c.id, zero()]));
  for (const p of partidas) {
    if (p.data > ate || (filtro && !filtro(p))) continue;
    const s = m.get(p.contaId);
    if (!s) continue;
    const sinal = p.tipo === "DEBITO" ? p.valor : -p.valor;
    if (de && p.data < de) s.anterior += sinal;
    else if (p.tipo === "DEBITO") s.debitos += p.valor;
    else s.creditos += p.valor;
  }
  for (const s of m.values()) s.final = s.anterior + s.debitos - s.creditos;
  // Soma nas sintéticas, das mais profundas para cima.
  const porId = new Map(contas.map((c) => [c.id, c]));
  const analiticas = contas.filter((c) => c.analitica);
  for (const c of analiticas) {
    const s = m.get(c.id)!;
    let pai = c.paiId ? porId.get(c.paiId) : undefined;
    while (pai) {
      const t = m.get(pai.id)!;
      t.anterior += s.anterior;
      t.debitos += s.debitos;
      t.creditos += s.creditos;
      t.final += s.final;
      pai = pai.paiId ? porId.get(pai.paiId) : undefined;
    }
  }
  return m;
}

const vazio = (s: Movimento) => s.anterior === 0n && s.debitos === 0n && s.creditos === 0n;

/** "1.234,56 D" ou "1.234,56 C" (zero sem letra). */
export function saldoDC(v: bigint): string {
  if (v === 0n) return "0,00";
  return `${formatarReais(v < 0n ? -v : v).replace("R$ ", "")} ${v > 0n ? "D" : "C"}`;
}
const reais = (v: bigint) => formatarReais(v).replace("R$ ", "");

// ---------------------------------------------------------------------------
// Modelo de tabela comum à tela e às exportações (PDF, XLSX, CSV)
// ---------------------------------------------------------------------------

export interface Coluna {
  rotulo: string;
  valor?: boolean; // alinhado à direita, número
  largura?: number; // proporção relativa (PDF/XLSX)
}

export interface Linha {
  celulas: (string | bigint | null)[]; // bigint = centavos (formatado como valor)
  nivel?: number; // recuo da primeira coluna
  destaque?: "total" | "grupo" | "subtotal";
}

export interface Tabela {
  titulo: string;
  colunas: Coluna[];
  linhas: Linha[];
  notas?: string[];
  alerta?: string; // ex.: "não fecha"
}

export function textoCelula(c: string | bigint | null, comoSaldo = false): string {
  if (c === null) return "";
  if (typeof c === "bigint") return comoSaldo ? saldoDC(c) : reais(c);
  return c;
}

// ---------------------------------------------------------------------------
// Balancete
// ---------------------------------------------------------------------------

export function balancete(contas: ContaR[], partidas: PartidaR[], de: Date, ate: Date): Tabela {
  const s = calcularSaldos(contas, partidas, de, ate);
  const ordenadas = [...contas].sort((a, b) => compararCodigos(a.codigo, b.codigo));
  const linhas: Linha[] = [];
  let td = 0n, tc = 0n, ta = 0n, tf = 0n;
  for (const c of ordenadas) {
    const m = s.get(c.id)!;
    if (vazio(m)) continue;
    linhas.push({
      celulas: [c.codigo, c.nome, saldoDC(m.anterior), m.debitos, m.creditos, saldoDC(m.final)],
      nivel: c.nivel - 1,
      destaque: c.analitica ? undefined : c.nivel === 1 ? "grupo" : "subtotal",
    });
    if (c.analitica) {
      td += m.debitos;
      tc += m.creditos;
      ta += m.anterior;
      tf += m.final;
    }
  }
  linhas.push({ celulas: ["", "Totais", saldoDC(ta), td, tc, saldoDC(tf)], destaque: "total" });
  const fecha = td === tc && ta === 0n && tf === 0n;
  return {
    titulo: "Balancete de verificação",
    colunas: [{ rotulo: "Conta", largura: 1.2 }, { rotulo: "Nome", largura: 3 }, { rotulo: "Saldo anterior", valor: true }, { rotulo: "Débitos", valor: true }, { rotulo: "Créditos", valor: true }, { rotulo: "Saldo atual", valor: true }],
    linhas,
    alerta: fecha ? undefined : "O balancete não fecha. Verifique os lançamentos.",
    notas: ["D = saldo devedor; C = saldo credor."],
  };
}

export function balanceteFecha(contas: ContaR[], partidas: PartidaR[], ate: Date): boolean {
  const s = calcularSaldos(contas, partidas, null, ate);
  let total = 0n;
  for (const c of contas) if (c.analitica) total += s.get(c.id)!.final;
  return total === 0n;
}

// ---------------------------------------------------------------------------
// Razão
// ---------------------------------------------------------------------------

export function razao(contas: ContaR[], partidas: PartidaR[], de: Date, ate: Date, contaIds?: string[]): Tabela {
  const porId = new Map(contas.map((c) => [c.id, c]));
  const porLanc = new Map<string, PartidaR[]>();
  for (const p of partidas) porLanc.set(p.lancamentoId, [...(porLanc.get(p.lancamentoId) ?? []), p]);
  const alvo = contas
    .filter((c) => c.analitica && (!contaIds || contaIds.includes(c.id)))
    .sort((a, b) => compararCodigos(a.codigo, b.codigo));
  const linhas: Linha[] = [];
  for (const c of alvo) {
    const minhas = partidas.filter((p) => p.contaId === c.id && p.data <= ate).sort((a, b) => a.data.getTime() - b.data.getTime() || a.numero - b.numero);
    const anteriores = minhas.filter((p) => p.data < de);
    const doPeriodo = minhas.filter((p) => p.data >= de);
    let saldo = anteriores.reduce((s, p) => s + (p.tipo === "DEBITO" ? p.valor : -p.valor), 0n);
    if (!doPeriodo.length && saldo === 0n) continue;
    linhas.push({ celulas: [`${c.codigo} ${c.nome}`, "", "", "", null, null, saldoDC(saldo)], destaque: "grupo" });
    let d = 0n, cr = 0n;
    for (const p of doPeriodo) {
      saldo += p.tipo === "DEBITO" ? p.valor : -p.valor;
      if (p.tipo === "DEBITO") d += p.valor;
      else cr += p.valor;
      const outras = (porLanc.get(p.lancamentoId) ?? []).filter((x) => x.tipo !== p.tipo);
      const contra = outras.length === 1 ? porId.get(outras[0].contaId)?.codigo ?? "" : "Diversas";
      linhas.push({
        celulas: [formatarData(p.data), String(p.numero), p.complemento ? `${p.historico} · ${p.complemento}` : p.historico, contra,
          p.tipo === "DEBITO" ? p.valor : null, p.tipo === "CREDITO" ? p.valor : null, saldoDC(saldo)],
      });
    }
    linhas.push({ celulas: ["", "", "Total do período", "", d, cr, saldoDC(saldo)], destaque: "subtotal" });
  }
  return {
    titulo: "Livro razão",
    colunas: [{ rotulo: "Data", largura: 1 }, { rotulo: "Nº", largura: 0.6 }, { rotulo: "Histórico", largura: 3.4 }, { rotulo: "Contrapartida", largura: 1.2 }, { rotulo: "Débito", valor: true }, { rotulo: "Crédito", valor: true }, { rotulo: "Saldo", valor: true }],
    linhas,
  };
}

// ---------------------------------------------------------------------------
// Diário
// ---------------------------------------------------------------------------

export function diario(contas: ContaR[], partidas: PartidaR[], de: Date, ate: Date): Tabela {
  const porId = new Map(contas.map((c) => [c.id, c]));
  const doPeriodo = partidas.filter((p) => p.data >= de && p.data <= ate);
  const lancs = new Map<string, PartidaR[]>();
  for (const p of doPeriodo) lancs.set(p.lancamentoId, [...(lancs.get(p.lancamentoId) ?? []), p]);
  const ordem = [...lancs.values()].sort((a, b) => a[0].data.getTime() - b[0].data.getTime() || a[0].numero - b[0].numero);
  const linhas: Linha[] = [];
  let td = 0n, tc = 0n;
  for (const ps of ordem) {
    const p0 = ps[0];
    linhas.push({ celulas: [formatarData(p0.data), String(p0.numero), p0.historico, null, null], destaque: "grupo" });
    for (const p of [...ps].sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "DEBITO" ? -1 : 1))) {
      const c = porId.get(p.contaId)!;
      linhas.push({ celulas: ["", "", `${p.tipo === "DEBITO" ? "D" : "C"}  ${c.codigo} ${c.nome}${p.complemento ? ` · ${p.complemento}` : ""}`, p.tipo === "DEBITO" ? p.valor : null, p.tipo === "CREDITO" ? p.valor : null], nivel: 1 });
      if (p.tipo === "DEBITO") td += p.valor;
      else tc += p.valor;
    }
  }
  linhas.push({ celulas: ["", "", "Totais", td, tc], destaque: "total" });
  return {
    titulo: "Livro diário",
    colunas: [{ rotulo: "Data", largura: 1 }, { rotulo: "Nº", largura: 0.6 }, { rotulo: "Histórico e contas", largura: 4.4 }, { rotulo: "Débito", valor: true }, { rotulo: "Crédito", valor: true }],
    linhas,
  };
}

// ---------------------------------------------------------------------------
// Balanço patrimonial
// ---------------------------------------------------------------------------

function arvore(contas: ContaR[], saldos: Map<string, Movimento>, grupo: GrupoConta, inverter: boolean, nivelMax: number): Linha[] {
  return contas
    .filter((c) => c.grupo === grupo && c.nivel <= nivelMax)
    .sort((a, b) => compararCodigos(a.codigo, b.codigo))
    .filter((c) => saldos.get(c.id)!.final !== 0n)
    .map((c) => {
      const v = saldos.get(c.id)!.final;
      return { celulas: [c.codigo, c.nome, inverter ? -v : v], nivel: c.nivel - 1, destaque: c.nivel === 1 ? "grupo" : !c.analitica ? "subtotal" : undefined } as Linha;
    });
}

export interface ResultadoBalanco extends Tabela {
  ativo: bigint;
  passivoMaisPl: bigint;
  resultadoNaoEncerrado: bigint;
}

export function balanco(contas: ContaR[], partidas: PartidaR[], ate: Date, nivelMax = 4): ResultadoBalanco {
  const s = calcularSaldos(contas, partidas, null, ate);
  const somaGrupo = (g: GrupoConta) => contas.filter((c) => c.grupo === g && c.analitica).reduce((t, c) => t + s.get(c.id)!.final, 0n);
  const ativo = somaGrupo("ATIVO");
  const passivo = -somaGrupo("PASSIVO");
  const pl = -somaGrupo("PATRIMONIO_LIQUIDO");
  const resultado = -(somaGrupo("RECEITA") + somaGrupo("CUSTO") + somaGrupo("DESPESA") + somaGrupo("APURACAO"));
  const linhas: Linha[] = [
    ...arvore(contas, s, "ATIVO", false, nivelMax),
    { celulas: ["", "Total do ativo", ativo], destaque: "total" },
    ...arvore(contas, s, "PASSIVO", true, nivelMax),
    { celulas: ["", "Total do passivo", passivo], destaque: "subtotal" },
    ...arvore(contas, s, "PATRIMONIO_LIQUIDO", true, nivelMax),
  ];
  if (resultado !== 0n) linhas.push({ celulas: ["", "Resultado do período ainda não apurado", resultado], nivel: 1 });
  linhas.push({ celulas: ["", "Total do patrimônio líquido", pl + resultado], destaque: "subtotal" });
  linhas.push({ celulas: ["", "Total do passivo e do patrimônio líquido", passivo + pl + resultado], destaque: "total" });
  return {
    titulo: "Balanço patrimonial",
    colunas: [{ rotulo: "Conta", largura: 1 }, { rotulo: "Descrição", largura: 4 }, { rotulo: `Saldo em ${formatarData(ate)}`, valor: true, largura: 1.6 }],
    linhas,
    ativo,
    passivoMaisPl: passivo + pl + resultado,
    resultadoNaoEncerrado: resultado,
    alerta: ativo === passivo + pl + resultado ? undefined : "Ativo e passivo + PL não são iguais. Verifique os lançamentos.",
    notas: ["Contas redutoras aparecem com valor negativo dentro do seu grupo."],
  };
}

// ---------------------------------------------------------------------------
// DRE
// ---------------------------------------------------------------------------

export interface ResultadoDre extends Tabela {
  receitas: bigint;
  custos: bigint;
  despesas: bigint;
  resultado: bigint;
}

export function dre(contas: ContaR[], partidas: PartidaR[], de: Date, ate: Date, nivelMax = 4): ResultadoDre {
  // A apuração do resultado zera as contas: fica fora da DRE.
  const s = calcularSaldos(contas, partidas, de, ate, (p) => p.origem !== "ENCERRAMENTO");
  const mov = (c: ContaR) => s.get(c.id)!.debitos - s.get(c.id)!.creditos; // devedor positivo, só do período
  const soma = (g: GrupoConta) => contas.filter((c) => c.grupo === g && c.analitica).reduce((t, c) => t + mov(c), 0n);
  const receitas = -soma("RECEITA");
  const custos = soma("CUSTO");
  const despesas = soma("DESPESA");
  const resultado = receitas - custos - despesas;
  const ramo = (g: GrupoConta, inverter: boolean) =>
    contas
      .filter((c) => c.grupo === g && c.nivel <= nivelMax && mov(c) !== 0n)
      .sort((a, b) => compararCodigos(a.codigo, b.codigo))
      .map((c) => ({ celulas: [c.codigo, c.nome, inverter ? -mov(c) : mov(c)], nivel: c.nivel - 1, destaque: c.nivel === 1 ? "grupo" : !c.analitica ? "subtotal" : undefined }) as Linha);
  const linhas: Linha[] = [
    ...ramo("RECEITA", true),
    { celulas: ["", "Total das receitas", receitas], destaque: "subtotal" },
    ...ramo("CUSTO", false),
    { celulas: ["", "Total dos custos", custos], destaque: "subtotal" },
    { celulas: ["", "Resultado bruto (receitas menos custos)", receitas - custos], destaque: "total" },
    ...ramo("DESPESA", false),
    { celulas: ["", "Total das despesas", despesas], destaque: "subtotal" },
    { celulas: ["", resultado >= 0n ? "Lucro do período" : "Prejuízo do período", resultado], destaque: "total" },
  ];
  return {
    titulo: "Demonstração do resultado (DRE)",
    colunas: [{ rotulo: "Conta", largura: 1 }, { rotulo: "Descrição", largura: 4 }, { rotulo: `${formatarData(de)} a ${formatarData(ate)}`, valor: true, largura: 1.6 }],
    linhas, receitas, custos, despesas, resultado,
    notas: ["Deduções da receita aparecem negativas dentro das receitas. Lançamentos de apuração do resultado não entram."],
  };
}

// ---------------------------------------------------------------------------
// Fluxo de caixa (método direto)
// ---------------------------------------------------------------------------
// Para cada lançamento que mexe em conta de caixa e equivalentes, a variação
// líquida do caixa é rateada entre as contrapartidas do lado oposto, na
// proporção dos valores: uma venda de 5.000 com 3.000 à vista atribui 3.000
// às vendas (os 2.000 a prazo não passaram pelo caixa). A soma bate em
// centavos com a variação do caixa. As contrapartidas são agrupadas pela
// conta de nível 2 (ex.: 3.1 Receita bruta, 5.1 Despesas operacionais).

export interface ResultadoFluxo extends Tabela {
  saldoInicial: bigint;
  saldoFinal: bigint;
  variacao: bigint;
}

export function fluxoDeCaixa(contas: ContaR[], partidas: PartidaR[], de: Date, ate: Date): ResultadoFluxo {
  const porId = new Map(contas.map((c) => [c.id, c]));
  const caixa = new Set(contas.filter((c) => c.disponivel).map((c) => c.id));
  const nivel2 = (c: ContaR): ContaR => {
    let atual = c;
    while (atual.nivel > 2 && atual.paiId && porId.get(atual.paiId)) atual = porId.get(atual.paiId)!;
    return atual;
  };
  const saldoCaixa = (ate_: Date, antes = false) =>
    partidas.filter((p) => caixa.has(p.contaId) && (antes ? p.data < ate_ : p.data <= ate_)).reduce((t, p) => t + (p.tipo === "DEBITO" ? p.valor : -p.valor), 0n);

  const lancs = new Map<string, PartidaR[]>();
  for (const p of partidas) if (p.data >= de && p.data <= ate) lancs.set(p.lancamentoId, [...(lancs.get(p.lancamentoId) ?? []), p]);
  const porCategoria = new Map<string, { conta: ContaR; entradas: bigint; saidas: bigint }>();
  const somar = (contaId: string, efeito: bigint) => {
    const cat = nivel2(porId.get(contaId)!);
    const t = porCategoria.get(cat.id) ?? { conta: cat, entradas: 0n, saidas: 0n };
    if (efeito > 0n) t.entradas += efeito;
    else t.saidas += -efeito;
    porCategoria.set(cat.id, t);
  };
  for (const ps of lancs.values()) {
    const efeitoCaixa = ps.filter((p) => caixa.has(p.contaId)).reduce((t, p) => t + (p.tipo === "DEBITO" ? p.valor : -p.valor), 0n);
    if (efeitoCaixa === 0n) continue;
    // Entrada de caixa vem dos créditos fora do caixa; saída vai para os débitos fora do caixa.
    const ladoOposto = ps.filter((p) => !caixa.has(p.contaId) && p.tipo === (efeitoCaixa > 0n ? "CREDITO" : "DEBITO"));
    const base = ladoOposto.reduce((t, p) => t + p.valor, 0n);
    const alvo = efeitoCaixa > 0n ? efeitoCaixa : -efeitoCaixa;
    // Rateio proporcional em centavos, com o resto distribuído pelos maiores restos.
    const cotas = ladoOposto.map((p) => ({ p, inteiro: (alvo * p.valor) / base, resto: (alvo * p.valor) % base }));
    let falta = alvo - cotas.reduce((t, c) => t + c.inteiro, 0n);
    for (const c of [...cotas].sort((a, b) => (b.resto > a.resto ? 1 : b.resto < a.resto ? -1 : 0))) {
      if (falta <= 0n) break;
      c.inteiro += 1n;
      falta -= 1n;
    }
    for (const c of cotas) somar(c.p.contaId, efeitoCaixa > 0n ? c.inteiro : -c.inteiro);
  }
  const saldoInicial = saldoCaixa(de, true);
  const saldoFinal = saldoCaixa(ate);
  const cats = [...porCategoria.values()].sort((a, b) => compararCodigos(a.conta.codigo, b.conta.codigo));
  const entradas = cats.reduce((t, c) => t + c.entradas, 0n);
  const saidas = cats.reduce((t, c) => t + c.saidas, 0n);
  const linhas: Linha[] = [
    { celulas: ["Saldo inicial de caixa e equivalentes", null, null, saldoInicial], destaque: "subtotal" },
    ...cats.map((c) => ({ celulas: [`${c.conta.codigo} ${c.conta.nome}`, c.entradas || null, c.saidas || null, c.entradas - c.saidas], nivel: 1 }) as Linha),
    { celulas: ["Variação no período", entradas, saidas, entradas - saidas], destaque: "subtotal" },
    { celulas: ["Saldo final de caixa e equivalentes", null, null, saldoFinal], destaque: "total" },
  ];
  return {
    titulo: "Fluxo de caixa (método direto)",
    colunas: [{ rotulo: "Origem ou destino do dinheiro", largura: 4 }, { rotulo: "Entradas", valor: true }, { rotulo: "Saídas", valor: true }, { rotulo: "Líquido", valor: true }],
    linhas, saldoInicial, saldoFinal, variacao: entradas - saidas,
    alerta: saldoInicial + entradas - saidas === saldoFinal ? undefined : "A variação não bate com os saldos de caixa. Verifique os lançamentos.",
    notas: [
      "Caixa e equivalentes são as contas marcadas como disponíveis no plano de contas.",
      "Agrupado pela conta de contrapartida (nível 2). A classificação em atividades operacionais, de investimento e de financiamento depende de revisão do contador.",
    ],
  };
}
