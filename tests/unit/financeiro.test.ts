import { describe, expect, it } from "vitest";
import { impressoes, lerOfx, valorOfx } from "@/lib/financeiro/ofx";
import { chaveRegra, confianca, regraQueCasa, semelhanca } from "@/lib/financeiro/conciliacao";
import { ratear } from "@/lib/financeiro/integracao";
import { dividirEmParcelas, somarMeses } from "@/lib/financeiro/financeiro";

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>0341<ACCTID>12345-6</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260301<DTEND>20260331
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260305120000[-3:BRT]<TRNAMT>-4500.00<FITID>A1<MEMO>PIX ENVIADO IMOBILIARIA BOA VISTA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260328<TRNAMT>-89,90<MEMO>TARIFA PACOTE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260328<TRNAMT>-89,90<MEMO>TARIFA PACOTE</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260310<TRNAMT>1500<FITID>A3<NAME>Cliente &amp; Cia<MEMO>TED RECEBIDA</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>12345.67<DTASOF>20260331</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe("OFX", () => {
  it("lê transações, valores com ponto ou vírgula, saldo e conta", () => {
    const o = lerOfx(Buffer.from(OFX_SGML, "latin1"));
    expect(o.conta).toBe("12345-6");
    expect(o.transacoes).toHaveLength(4);
    expect(o.transacoes[0]).toMatchObject({ valorCentavos: -450000n, fitid: "A1" });
    expect(o.transacoes[1].valorCentavos).toBe(-8990n);
    expect(o.transacoes[3].descricao).toBe("Cliente & Cia · TED RECEBIDA");
    expect(o.saldo).toBe(1234567n);
    expect(o.dataSaldo?.toISOString().slice(0, 10)).toBe("2026-03-31");
  });
  it("lê OFX 2 (XML)", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?><OFX><STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260402</DTPOSTED><TRNAMT>10.5</TRNAMT><FITID>X</FITID><MEMO>Depósito</MEMO></STMTTRN></OFX>`;
    expect(lerOfx(Buffer.from(xml)).transacoes[0]).toMatchObject({ valorCentavos: 1050n, descricao: "Depósito" });
  });
  it("recusa arquivo que não é OFX e valores estranhos", () => {
    expect(() => lerOfx(Buffer.from("%PDF-1.7"))).toThrow(/OFX/);
    expect(() => valorOfx("12.345,67")).toThrow();
  });
  it("impressão digital: estável, distingue tarifas iguais no mesmo dia", () => {
    const ts = lerOfx(Buffer.from(OFX_SGML, "latin1")).transacoes;
    const a = impressoes("conta", ts);
    expect(new Set(a).size).toBe(4);
    expect(impressoes("conta", ts)).toEqual(a);
    expect(impressoes("outra", ts)[0]).not.toBe(a[0]);
  });
});

describe("conciliação: pontuação e regras", () => {
  it("semelhança ignora palavras genéricas e acentos", () => {
    expect(semelhanca("PIX ENVIADO IMOBILIARIA BOA VISTA", "Aluguel março Imobiliária Boa Vista")).toBeGreaterThan(0.4);
    expect(semelhanca("PIX ENVIADO", "Pagamento PIX")).toBe(0);
  });
  it("confiança: mesma data e texto parecido passa de 90; fora da tolerância é zero", () => {
    const t = { data: new Date("2026-03-05"), descricao: "PIX IMOBILIARIA BOA VISTA" };
    expect(confianca(t, { data: new Date("2026-03-05"), texto: "Aluguel Imobiliária Boa Vista" }, 3, true)).toBeGreaterThanOrEqual(90);
    expect(confianca(t, { data: new Date("2026-03-10"), texto: "x" }, 3, true)).toBe(0);
    expect(confianca(t, { data: new Date("2026-03-07"), texto: "outra coisa" }, 3, false)).toBeLessThan(50);
  });
  it("regra aprendida casa pelas palavras da descrição", () => {
    const chave = chaveRegra("TARIFA PACOTE SERVICOS 03/2026");
    expect(chave).toBe("tarifa pacote servicos");
    expect(regraQueCasa([{ texto: chave }, { texto: "tarifa" }], "Tarifa pacote serviços abril")?.texto).toBe(chave);
    expect(regraQueCasa([{ texto: chave }], "Tarifa DOC")).toBeNull();
  });
});

describe("contas", () => {
  it("parcelas e rateio não perdem centavos", () => {
    expect(dividirEmParcelas(10000n, 3)).toEqual([3333n, 3333n, 3334n]);
    const r = ratear(10001n, [1n, 1n, 1n]);
    expect(r.reduce((a, b) => a + b, 0n)).toBe(10001n);
    expect(ratear(5000n, [7000n, 3000n])).toEqual([3500n, 1500n]);
  });
  it("soma meses respeitando o fim do mês", () => {
    expect(somarMeses(new Date("2026-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(somarMeses(new Date("2026-12-15T00:00:00Z"), 2).toISOString().slice(0, 10)).toBe("2027-02-15");
  });
});
