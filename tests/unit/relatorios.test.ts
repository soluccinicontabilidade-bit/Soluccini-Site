import { describe, expect, it } from "vitest";
import type { GrupoConta, NaturezaConta, OrigemLancamento } from "@prisma/client";
import { balancete, balanco, calcularSaldos, dre, fluxoDeCaixa, razao, diario, saldoDC, type ContaR, type PartidaR } from "@/lib/contabil/relatorios";
import { codigoDoPai, compararCodigos, contasDoModelo, validarCodigo } from "@/lib/contabil/plano";
import { paraCsv, paraPdf, paraXlsx } from "@/lib/contabil/exportar";

// Plano mínimo
const c = (id: string, codigo: string, grupo: GrupoConta, analitica: boolean, paiId: string | null, extra: Partial<ContaR> = {}): ContaR => ({
  id, codigo, nome: id, grupo, natureza: (["ATIVO", "CUSTO", "DESPESA"].includes(grupo) ? "DEVEDORA" : "CREDORA") as NaturezaConta,
  analitica, paiId, nivel: codigo.split(".").length, disponivel: false, ...extra,
});
const contas: ContaR[] = [
  c("ativo", "1", "ATIVO", false, null),
  c("banco", "1.1", "ATIVO", true, "ativo", { disponivel: true }),
  c("clientes", "1.2", "ATIVO", true, "ativo"),
  c("passivo", "2", "PASSIVO", false, null),
  c("fornec", "2.1", "PASSIVO", true, "passivo"),
  c("pl", "2.3", "PATRIMONIO_LIQUIDO", false, null),
  c("capital", "2.3.1", "PATRIMONIO_LIQUIDO", true, "pl"),
  c("lucros", "2.3.2", "PATRIMONIO_LIQUIDO", true, "pl"),
  c("receita", "3", "RECEITA", false, null),
  c("vendas", "3.1", "RECEITA", true, "receita"),
  c("deducoes", "3.2", "RECEITA", true, "receita"),
  c("custo", "4", "CUSTO", false, null),
  c("cmv", "4.1", "CUSTO", true, "custo"),
  c("despesa", "5", "DESPESA", false, null),
  c("aluguel", "5.1", "DESPESA", true, "despesa"),
];

let n = 0;
function lanc(data: string, partes: [string, "D" | "C", number][], origem: OrigemLancamento = "MANUAL"): PartidaR[] {
  n++;
  return partes.map(([contaId, t, reais]) => ({
    contaId, tipo: t === "D" ? "DEBITO" : "CREDITO", valor: BigInt(Math.round(reais * 100)), lancamentoId: `L${n}`, numero: n,
    data: new Date(`${data}T00:00:00Z`), historico: `Lançamento ${n}`, origem, complemento: null,
  }));
}
const d = (s: string) => new Date(`${s}T00:00:00Z`);

const partidas = [
  ...lanc("2026-01-01", [["banco", "D", 10000], ["capital", "C", 10000]], "SALDO_INICIAL"), // integralização
  ...lanc("2026-02-05", [["banco", "D", 3000], ["clientes", "D", 2000], ["vendas", "C", 5000]]), // venda à vista e a prazo
  ...lanc("2026-02-06", [["deducoes", "D", 300], ["fornec", "C", 300]]), // tributo sobre venda (a pagar)
  ...lanc("2026-02-10", [["cmv", "D", 1500], ["fornec", "C", 1500]]),
  ...lanc("2026-02-15", [["aluguel", "D", 800], ["banco", "C", 800]]),
  ...lanc("2026-02-20", [["fornec", "D", 1000], ["banco", "C", 1000]]), // pagamento a fornecedor
  ...lanc("2026-03-01", [["banco", "D", 2000], ["clientes", "C", 2000]]), // recebimento em março
];

describe("saldos", () => {
  it("acumula das analíticas para as sintéticas e separa saldo anterior", () => {
    const s = calcularSaldos(contas, partidas, d("2026-02-01"), d("2026-02-28"));
    expect(s.get("banco")).toEqual({ anterior: 1000000n, debitos: 300000n, creditos: 180000n, final: 1120000n });
    expect(s.get("ativo")!.final).toBe(1120000n + 200000n);
    expect(saldoDC(-123456n)).toBe("1.234,56 C");
    expect(saldoDC(5n)).toBe("0,05 D");
  });
});

describe("balancete", () => {
  it("fecha: total de débitos igual ao de créditos", () => {
    const t = balancete(contas, partidas, d("2026-02-01"), d("2026-02-28"));
    expect(t.alerta).toBeUndefined();
    const total = t.linhas.at(-1)!;
    expect(total.celulas[3]).toBe(total.celulas[4]);
    expect(total.celulas[3]).toBe(5000n * 100n + 300n * 100n + 1500n * 100n + 800n * 100n + 1000n * 100n);
  });
  it("acusa quando a base não fecha", () => {
    const quebrada = [...partidas, ...lanc("2026-02-28", [["banco", "D", 1]])];
    expect(balancete(contas, quebrada, d("2026-02-01"), d("2026-02-28")).alerta).toMatch(/não fecha/);
  });
});

describe("DRE", () => {
  it("receitas líquidas de deduções, custos, despesas e resultado", () => {
    const r = dre(contas, partidas, d("2026-02-01"), d("2026-02-28"));
    expect(r.receitas).toBe(470000n); // 5.000 - 300
    expect(r.custos).toBe(150000n);
    expect(r.despesas).toBe(80000n);
    expect(r.resultado).toBe(240000n);
  });
  it("ignora a apuração do resultado", () => {
    const comApuracao = [...partidas, ...lanc("2026-02-28", [["vendas", "D", 5000], ["deducoes", "C", 300], ["cmv", "C", 1500], ["aluguel", "C", 800], ["lucros", "C", 2400]], "ENCERRAMENTO")];
    expect(dre(contas, comApuracao, d("2026-02-01"), d("2026-02-28")).resultado).toBe(240000n);
  });
});

describe("balanço", () => {
  it("ativo = passivo + PL, com o resultado não apurado no PL", () => {
    const b = balanco(contas, partidas, d("2026-02-28"));
    expect(b.ativo).toBe(1120000n + 200000n);
    expect(b.resultadoNaoEncerrado).toBe(240000n);
    expect(b.passivoMaisPl).toBe(b.ativo);
    expect(b.alerta).toBeUndefined();
  });
  it("depois da apuração o resultado sai do 'não apurado' e entra em lucros", () => {
    const apurado = [...partidas, ...lanc("2026-02-28", [["vendas", "D", 5000], ["deducoes", "C", 300], ["cmv", "C", 1500], ["aluguel", "C", 800], ["lucros", "C", 2400]], "ENCERRAMENTO")];
    const b = balanco(contas, apurado, d("2026-02-28"));
    expect(b.resultadoNaoEncerrado).toBe(0n);
    expect(b.passivoMaisPl).toBe(b.ativo);
  });
});

describe("fluxo de caixa", () => {
  it("variação bate com os saldos e é atribuída às contrapartidas", () => {
    const f = fluxoDeCaixa(contas, partidas, d("2026-02-01"), d("2026-02-28"));
    expect(f.saldoInicial).toBe(1000000n);
    expect(f.saldoFinal).toBe(1120000n);
    expect(f.variacao).toBe(120000n);
    expect(f.alerta).toBeUndefined();
    const vendas = f.linhas.find((l) => String(l.celulas[0]).startsWith("3.1"));
    expect(vendas?.celulas[1]).toBe(300000n); // só a parte à vista entrou no caixa
  });
  it("transferência entre contas de caixa não aparece como entrada nem saída", () => {
    const comCaixa: ContaR[] = [...contas, c("caixa", "1.3", "ATIVO", true, "ativo", { disponivel: true })];
    const p = [...partidas, ...lanc("2026-02-25", [["caixa", "D", 500], ["banco", "C", 500]])];
    const f = fluxoDeCaixa(comCaixa, p, d("2026-02-01"), d("2026-02-28"));
    expect(f.variacao).toBe(120000n);
  });
});

describe("razão e diário", () => {
  it("razão mostra saldo anterior, movimento e saldo acumulado", () => {
    const t = razao(contas, partidas, d("2026-02-01"), d("2026-02-28"), ["banco"]);
    expect(t.linhas[0].celulas.at(-1)).toBe("10.000,00 D");
    expect(t.linhas.at(-1)!.celulas.at(-1)).toBe("11.200,00 D");
    expect(t.linhas.find((l) => l.celulas[1] === "2")!.celulas[3]).toBe("3.1"); // contrapartida única
  });
  it("diário lista cada lançamento com suas partidas e totais iguais", () => {
    const t = diario(contas, partidas, d("2026-02-01"), d("2026-02-28"));
    const tot = t.linhas.at(-1)!;
    expect(tot.celulas[3]).toBe(tot.celulas[4]);
  });
});

describe("plano de contas", () => {
  it("ordena códigos numericamente e acha o pai do mesmo grupo", () => {
    expect(["1.10", "1.2", "1.1.01", "2"].sort(compararCodigos)).toEqual(["1.1.01", "1.2", "1.10", "2"]);
    const mapa = new Map<string, GrupoConta>([["2", "PASSIVO"], ["2.3", "PATRIMONIO_LIQUIDO"]]);
    expect(codigoDoPai("2.3", mapa, "PATRIMONIO_LIQUIDO")).toBeNull();
    expect(codigoDoPai("2.3.1", mapa, "PATRIMONIO_LIQUIDO")).toBe("2.3");
    expect(validarCodigo("1.1.a")).not.toBeNull();
  });
  it("modelo padrão: códigos únicos, contas redutoras com natureza invertida, caixa marcado", () => {
    const m = contasDoModelo();
    expect(new Set(m.map((x) => x.codigo)).size).toBe(m.length);
    expect(m.find((x) => x.codigo === "1.2.3.90")).toMatchObject({ natureza: "CREDORA", grupo: "ATIVO" });
    expect(m.find((x) => x.codigo === "3.2.1.02")).toMatchObject({ natureza: "DEVEDORA", grupo: "RECEITA" });
    expect(m.filter((x) => x.disponivel).map((x) => x.codigo)).toEqual(["1.1.1.01", "1.1.1.02", "1.1.1.03"]);
  });
});

describe("exportação", () => {
  const cab = { escritorio: "Soluccini", cliente: "Padaria Ação & Cia", documento: "11.222.333/0001-81", periodo: "01/02/2026 a 28/02/2026", emitidoEm: "21/11/2026 10:00", emitidoPor: "Carla" };
  const t = balancete(contas, partidas, d("2026-02-01"), d("2026-02-28"));
  it("CSV com BOM, ponto e vírgula e acentos", () => {
    const csv = paraCsv(t, cab);
    expect(csv.startsWith("﻿Balancete")).toBe(true);
    expect(csv).toContain("Padaria Ação & Cia;11.222.333/0001-81");
    expect(csv).toContain("10.000,00 D");
  });
  it("XLSX é um arquivo zip válido", async () => {
    const x = await paraXlsx(t, cab);
    expect(x.subarray(0, 2).toString()).toBe("PK");
  });
  it("PDF válido e com mais de uma página quando a tabela é longa", async () => {
    const longa = { ...t, linhas: Array.from({ length: 120 }, () => t.linhas[1]) };
    const pdf = await paraPdf(longa, cab);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const paginas = pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;
    expect(paginas).toBeGreaterThan(1);
    expect(paginas).toBeLessThan(6);
  });
});

describe("fluxo de caixa: rateio", () => {
  it("rateia em centavos sem perder nem sobrar", () => {
    const p = lanc("2026-02-27", [["banco", "D", 100], ["vendas", "C", 33.33], ["clientes", "C", 33.33], ["fornec", "C", 33.34]]);
    const f = fluxoDeCaixa(contas, p, d("2026-02-01"), d("2026-02-28"));
    expect(f.variacao).toBe(10000n);
    expect(f.alerta).toBeUndefined();
  });
});
