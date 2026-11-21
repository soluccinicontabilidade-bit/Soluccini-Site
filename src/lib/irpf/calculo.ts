// Cálculo do IRPF a partir de parâmetros versionados por ano-calendário.
// Nenhum valor fica fixo no código de cálculo: tudo vem de `ParametrosIRPF`,
// guardado na tabela tabela_irpf e editável pelo administrador.
// Valores em centavos (bigint); alíquotas em pontos-base (1% = 100);
// coeficientes do redutor em milionésimos (0,095575 = 95575).

export interface Faixa {
  ate: string | null; // limite superior em centavos (texto, para caber em JSON); null = sem limite
  aliquotaBp: number;
  deduzir: string; // parcela a deduzir, centavos
}

export interface ParametrosIRPF {
  anual: {
    faixas: Faixa[];
    // Redução: até `isencaoAte` o imposto é reduzido até zerar (no máximo `reducaoMaxima`);
    // até `redutorAte`, redução = a − b × rendimentos; acima, sem redução.
    reducao: { isencaoAte: string; reducaoMaxima: string; redutorAte: string; a: string; bMilionesimos: number } | null;
    dependente: string;
    instrucaoPorPessoa: string;
    pgblLimiteBp: number; // % da renda tributável
    descontoSimplificadoBp: number;
    descontoSimplificadoLimite: string;
  };
  mensal: {
    faixas: Faixa[];
    reducao: { isencaoAte: string; redutorAte: string; a: string; bMilionesimos: number } | null;
    descontoSimplificado: string;
  };
  avisos?: string[];
}

const C = (s: string) => BigInt(s);

/** Arredonda a divisão para o centavo mais próximo (meio para cima). */
function divArred(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  return r * 2n >= d ? q + 1n : q;
}

export function impostoPelaTabela(base: bigint, faixas: Faixa[]): bigint {
  if (base <= 0n) return 0n;
  const f = faixas.find((x) => x.ate === null || base <= C(x.ate))!;
  const v = divArred(base * BigInt(f.aliquotaBp), 10000n) - C(f.deduzir);
  return v > 0n ? v : 0n;
}

function reducao(imposto: bigint, rendimentos: bigint, r: { isencaoAte: string; redutorAte: string; a: string; bMilionesimos: number; reducaoMaxima?: string } | null): bigint {
  if (!r || imposto <= 0n) return 0n;
  if (rendimentos <= C(r.isencaoAte)) {
    const max = r.reducaoMaxima ? C(r.reducaoMaxima) : imposto;
    return imposto < max ? imposto : max;
  }
  if (rendimentos <= C(r.redutorAte)) {
    const red = C(r.a) - divArred(rendimentos * BigInt(r.bMilionesimos), 1_000_000n);
    if (red <= 0n) return 0n;
    return red < imposto ? red : imposto;
  }
  return 0n;
}

export interface ResultadoMensal {
  base: bigint;
  impostoTabela: bigint;
  reducao: bigint;
  imposto: bigint;
}

/** Retenção mensal com desconto simplificado (o caso de teste divulgado pela Receita). */
export function calcularMensal(rendimento: bigint, p: ParametrosIRPF, deducoes = 0n): ResultadoMensal {
  const desconto = deducoes > C(p.mensal.descontoSimplificado) ? deducoes : C(p.mensal.descontoSimplificado);
  const base = rendimento - desconto > 0n ? rendimento - desconto : 0n;
  const impostoTabela = impostoPelaTabela(base, p.mensal.faixas);
  const red = reducao(impostoTabela, rendimento, p.mensal.reducao);
  return { base, impostoTabela, reducao: red, imposto: impostoTabela - red };
}

export interface EntradaAnual {
  rendimentosTributaveis: bigint;
  previdenciaOficial: bigint;
  dependentes: number;
  despesasMedicas: bigint;
  instrucao: bigint[]; // por pessoa (titular e dependentes)
  pgbl: bigint;
  pensaoAlimenticia: bigint;
  impostoRetido: bigint; // IRRF + carnê-leão pagos
  rendimentosTotais?: bigint; // inclui isentos e exclusivos, só para avisos
}

export interface ResultadoModelo {
  deducoes: bigint;
  base: bigint;
  impostoTabela: bigint;
  reducao: bigint;
  impostoDevido: bigint;
  saldo: bigint; // positivo = a pagar; negativo = a restituir
  detalhes: [string, bigint][];
}

export interface ResultadoAnual {
  completo: ResultadoModelo;
  simplificado: ResultadoModelo;
  melhor: "COMPLETO" | "SIMPLIFICADO";
  avisos: string[];
}

export function calcularAnual(e: EntradaAnual, p: ParametrosIRPF): ResultadoAnual {
  const a = p.anual;
  const renda = e.rendimentosTributaveis;
  const instrucao = e.instrucao.reduce((s, v) => s + (v < C(a.instrucaoPorPessoa) ? v : C(a.instrucaoPorPessoa)), 0n);
  const limitePgbl = divArred(renda * BigInt(a.pgblLimiteBp), 10000n);
  const pgbl = e.pgbl < limitePgbl ? e.pgbl : limitePgbl;
  const dependentes = BigInt(e.dependentes) * C(a.dependente);
  const detalhesCompleto: [string, bigint][] = [
    ["Previdência oficial", e.previdenciaOficial],
    [`Dependentes (${e.dependentes})`, dependentes],
    ["Despesas médicas", e.despesasMedicas],
    ["Instrução (limitada por pessoa)", instrucao],
    ["Previdência privada (PGBL, até o limite)", pgbl],
    ["Pensão alimentícia", e.pensaoAlimenticia],
  ];
  const dedCompleto = detalhesCompleto.reduce((s, [, v]) => s + v, 0n);
  const desconto = divArred(renda * BigInt(a.descontoSimplificadoBp), 10000n);
  const dedSimplificado = desconto < C(a.descontoSimplificadoLimite) ? desconto : C(a.descontoSimplificadoLimite);

  const modelo = (deducoes: bigint, detalhes: [string, bigint][]): ResultadoModelo => {
    const base = renda - deducoes > 0n ? renda - deducoes : 0n;
    const impostoTabela = impostoPelaTabela(base, a.faixas);
    const red = reducao(impostoTabela, renda, a.reducao);
    const devido = impostoTabela - red;
    return { deducoes, base, impostoTabela, reducao: red, impostoDevido: devido, saldo: devido - e.impostoRetido, detalhes };
  };
  const completo = modelo(dedCompleto, detalhesCompleto);
  const simplificado = modelo(dedSimplificado, [["Desconto simplificado", dedSimplificado]]);
  const avisos = [...(p.avisos ?? [])];
  if ((e.rendimentosTotais ?? renda) > 60_000_000n) {
    avisos.push("Rendimentos totais acima de R$ 600 mil: pode haver imposto mínimo (IRPFM), que este simulador não calcula.");
  }
  return { completo, simplificado, melhor: completo.impostoDevido <= simplificado.impostoDevido ? "COMPLETO" : "SIMPLIFICADO", avisos };
}

// ---------------------------------------------------------------------------
// Valores de referência do ano-calendário 2026 (Lei 15.270/2025), conforme o
// documento de especificação do escritório. Entram com confirmada = false: o
// administrador confere na Receita Federal e marca como confirmados.
// As faixas mensais são as anuais divididas por 12.
// ---------------------------------------------------------------------------

export const REFERENCIA_2026: ParametrosIRPF = {
  anual: {
    faixas: [
      { ate: "2914560", aliquotaBp: 0, deduzir: "0" },
      { ate: "3391980", aliquotaBp: 750, deduzir: "218592" },
      { ate: "4501260", aliquotaBp: 1500, deduzir: "472992" },
      { ate: "5597616", aliquotaBp: 2250, deduzir: "810588" },
      { ate: null, aliquotaBp: 2750, deduzir: "1090476" },
    ],
    reducao: { isencaoAte: "6000000", reducaoMaxima: "269415", redutorAte: "8820000", a: "842973", bMilionesimos: 95575 },
    dependente: "227508",
    instrucaoPorPessoa: "356150",
    pgblLimiteBp: 1200,
    descontoSimplificadoBp: 2000,
    descontoSimplificadoLimite: "1675434",
  },
  mensal: {
    faixas: [
      { ate: "242880", aliquotaBp: 0, deduzir: "0" },
      { ate: "282665", aliquotaBp: 750, deduzir: "18216" },
      { ate: "375105", aliquotaBp: 1500, deduzir: "39416" },
      { ate: "466468", aliquotaBp: 2250, deduzir: "67549" },
      { ate: null, aliquotaBp: 2750, deduzir: "90873" },
    ],
    reducao: { isencaoAte: "500000", redutorAte: "735000", a: "97862", bMilionesimos: 133145 },
    descontoSimplificado: "60720",
  },
  avisos: [
    "Lucros e dividendos acima de R$ 50 mil por mês pagos por uma mesma empresa têm retenção de 10% na fonte (informar na declaração; não entra neste cálculo).",
  ],
};

/** Validação mínima de parâmetros editados pelo administrador. */
export function validarParametros(p: unknown): ParametrosIRPF {
  const x = p as ParametrosIRPF;
  const faixasOk = (f: Faixa[]) =>
    Array.isArray(f) && f.length >= 2 && f.at(-1)!.ate === null &&
    f.every((y, i) => Number.isInteger(y.aliquotaBp) && /^\d+$/.test(y.deduzir) && (y.ate === null || /^\d+$/.test(y.ate)) && (i === 0 || y.aliquotaBp >= f[i - 1].aliquotaBp));
  if (!x?.anual || !x?.mensal || !faixasOk(x.anual.faixas) || !faixasOk(x.mensal.faixas)) throw new Error("Parâmetros inválidos: confira as faixas (a última sem limite, alíquotas crescentes).");
  for (const v of [x.anual.dependente, x.anual.instrucaoPorPessoa, x.anual.descontoSimplificadoLimite, x.mensal.descontoSimplificado]) {
    if (!/^\d+$/.test(String(v))) throw new Error("Parâmetros inválidos: valores em centavos, só dígitos.");
  }
  return x;
}
