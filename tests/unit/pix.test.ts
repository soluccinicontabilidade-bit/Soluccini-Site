import { describe, expect, it } from "vitest";
import { crc16, gerarPixCopiaECola, validarChavePix } from "@/lib/cobranca/pix";

describe("Pix copia e cola", () => {
  it("CRC16/CCITT-FALSE confere com o vetor de teste padrão", () => {
    expect(crc16("123456789")).toBe("29B1");
  });
  it("monta o BR Code com valor, recebedor, txid e CRC válido", () => {
    const p = gerarPixCopiaECola({ chave: "contato@soluccini.com.br", nome: "Soluccini Contábil", cidade: "São Paulo", valorCentavos: 120000n, txid: "SOL123ABC", descricao: "Honorários 03/2026" });
    expect(p.startsWith("000201")).toBe(true);
    expect(p).toContain("0014br.gov.bcb.pix0124contato@soluccini.com.br");
    expect(p).toContain("54071200.00");
    expect(p).toContain("5802BR5918SOLUCCINI CONTABIL6009SAO PAULO");
    expect(p).toContain("62130509SOL123ABC");
    expect(p.slice(-8, -4)).toBe("6304");
    expect(crc16(p.slice(0, -4))).toBe(p.slice(-4));
  });
  it("valida chaves", () => {
    expect(validarChavePix("11222333000181")).toBeNull();
    expect(validarChavePix("+5511999998888")).toBeNull();
    expect(validarChavePix("123e4567-e89b-12d3-a456-426614174000")).toBeNull();
    expect(validarChavePix("11.222.333/0001-81")).not.toBeNull();
  });
});
