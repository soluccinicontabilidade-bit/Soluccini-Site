import { describe, expect, it } from "vitest";
import {
  cnpjValido, cpfValido, formatarBp, formatarCnpj, formatarCpf, formatarReais, lerData,
  mascararDocumento, percentualParaBp, reaisParaCentavos,
} from "@/lib/br";

describe("CPF e CNPJ", () => {
  it("aceita documentos válidos, com ou sem máscara", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("52998224725")).toBe(true);
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("11222333000181")).toBe(true);
  });
  it("recusa dígito errado, tamanho errado e sequências repetidas", () => {
    expect(cpfValido("529.982.247-24")).toBe(false);
    expect(cpfValido("111.111.111-11")).toBe(false);
    expect(cpfValido("1234567890")).toBe(false);
    expect(cnpjValido("11.222.333/0001-80")).toBe(false);
    expect(cnpjValido("00000000000000")).toBe(false);
  });
  it("formata e mascara", () => {
    expect(formatarCpf("52998224725")).toBe("529.982.247-25");
    expect(formatarCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(mascararDocumento("PF", "4725")).toBe("***.***.*47-25");
    expect(mascararDocumento("PJ", "0181")).toBe("**.***.***/**01-81");
  });
});

describe("dinheiro em centavos", () => {
  it("converte reais escritos à brasileira", () => {
    expect(reaisParaCentavos("1.234,56")).toBe(123456n);
    expect(reaisParaCentavos("1234,5")).toBe(123450n);
    expect(reaisParaCentavos("R$ 10")).toBe(1000n);
    expect(reaisParaCentavos("-0,01")).toBe(-1n);
    expect(reaisParaCentavos("0,10")).toBe(10n);
  });
  it("não aceita mais de duas casas nem formatos ambíguos", () => {
    expect(() => reaisParaCentavos("1,234")).toThrow();
    expect(() => reaisParaCentavos("1.23")).toThrow();
    expect(() => reaisParaCentavos("abc")).toThrow();
  });
  it("valores grandes não perdem precisão", () => {
    expect(reaisParaCentavos("99.999.999.999.999,99")).toBe(9999999999999999n);
    expect(formatarReais(9999999999999999n)).toBe("R$ 99.999.999.999.999,99");
  });
  it("formata", () => {
    expect(formatarReais(123456n)).toBe("R$ 1.234,56");
    expect(formatarReais(-5n)).toBe("-R$ 0,05");
  });
});

describe("percentual em pontos-base", () => {
  it("converte e formata", () => {
    expect(percentualParaBp("50")).toBe(5000);
    expect(percentualParaBp("33,33")).toBe(3333);
    expect(percentualParaBp("100%")).toBe(10000);
    expect(formatarBp(3333)).toBe("33,33%");
  });
  it("recusa acima de 100% e mais de duas casas", () => {
    expect(() => percentualParaBp("100,01")).toThrow();
    expect(() => percentualParaBp("10,555")).toThrow();
  });
});

describe("datas", () => {
  it("lê dd/mm/aaaa e aaaa-mm-dd", () => {
    expect(lerData("31/12/2026").toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(lerData("2026-02-28").toISOString().slice(0, 10)).toBe("2026-02-28");
  });
  it("recusa datas inexistentes", () => {
    expect(() => lerData("30/02/2026")).toThrow();
    expect(() => lerData("2026-13-01")).toThrow();
  });
});
