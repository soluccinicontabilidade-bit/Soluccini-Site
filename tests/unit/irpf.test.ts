import { describe, expect, it } from "vitest";
import { calcularAnual, calcularMensal, impostoPelaTabela, REFERENCIA_2026, validarParametros } from "@/lib/irpf/calculo";

const p = REFERENCIA_2026;
const r = (reais: number) => BigInt(Math.round(reais * 100));

describe("IRPF mensal: caso de teste da Receita (AC 2026)", () => {
  it("R$ 6.000 com desconto simplificado de R$ 607,20 → base 5.392,80, tabela 574,29, redutor 179,75, IR 394,54", () => {
    const x = calcularMensal(r(6000), p);
    expect(x.base).toBe(r(5392.8));
    expect(x.impostoTabela).toBe(r(574.29));
    expect(x.reducao).toBe(r(179.75));
    expect(x.imposto).toBe(r(394.54));
  });
  it("até R$ 5.000 o imposto é zerado; acima de R$ 7.350 não há redução", () => {
    expect(calcularMensal(r(5000), p).imposto).toBe(0n);
    const alto = calcularMensal(r(10000), p);
    expect(alto.reducao).toBe(0n);
    expect(alto.imposto).toBe(alto.impostoTabela);
  });
});

describe("IRPF anual", () => {
  it("tabela progressiva por faixa", () => {
    expect(impostoPelaTabela(r(29145.6), p.anual.faixas)).toBe(0n);
    expect(impostoPelaTabela(r(100000), p.anual.faixas)).toBe(r(27500 - 10904.76));
  });
  it("redução: até R$ 60 mil zera o imposto (limite da redução)", () => {
    const x = calcularAnual({ rendimentosTributaveis: r(60000), previdenciaOficial: 0n, dependentes: 0, despesasMedicas: 0n, instrucao: [], pgbl: 0n, pensaoAlimenticia: 0n, impostoRetido: 0n }, p);
    expect(x.simplificado.impostoDevido).toBe(0n);
  });
  it("faixa intermediária usa o redutor linear; acima de R$ 88.200, nenhum", () => {
    const e = { previdenciaOficial: 0n, dependentes: 0, despesasMedicas: 0n, instrucao: [], pgbl: 0n, pensaoAlimenticia: 0n, impostoRetido: 0n };
    const m = calcularAnual({ ...e, rendimentosTributaveis: r(80000) }, p);
    expect(m.simplificado.reducao).toBe(r(8429.73) - r(80000 * 0.095575));
    expect(calcularAnual({ ...e, rendimentosTributaveis: r(100000) }, p).simplificado.reducao).toBe(0n);
  });
  it("completo × simplificado: limites de instrução, PGBL, desconto simplificado e saldo", () => {
    const x = calcularAnual({
      rendimentosTributaveis: r(150000), previdenciaOficial: r(10000), dependentes: 2, despesasMedicas: r(12000),
      instrucao: [r(8000), r(2000)], pgbl: r(30000), pensaoAlimenticia: 0n, impostoRetido: r(20000),
    }, p);
    expect(x.completo.deducoes).toBe(r(10000 + 2 * 2275.08 + 12000 + 3561.5 + 2000 + 18000));
    expect(x.simplificado.deducoes).toBe(r(16754.34)); // 20% de 150 mil passa do limite
    expect(x.melhor).toBe("COMPLETO");
    expect(x.completo.saldo).toBe(x.completo.impostoDevido - r(20000));
  });
  it("avisa sobre imposto mínimo acima de R$ 600 mil", () => {
    const x = calcularAnual({ rendimentosTributaveis: r(100000), rendimentosTotais: r(700000), previdenciaOficial: 0n, dependentes: 0, despesasMedicas: 0n, instrucao: [], pgbl: 0n, pensaoAlimenticia: 0n, impostoRetido: 0n }, p);
    expect(x.avisos.join()).toMatch(/IRPFM/);
  });
  it("valida parâmetros editados", () => {
    expect(() => validarParametros({ anual: { faixas: [] } })).toThrow();
    expect(validarParametros(JSON.parse(JSON.stringify(p)))).toBeTruthy();
  });
});
