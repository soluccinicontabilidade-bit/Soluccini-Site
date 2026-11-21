import { describe, expect, it } from "vitest";
import { analisarLinhas, lerPlanilha, modeloCsv } from "@/lib/importacao";
import { hashDocumento } from "@/lib/clientes";

const csv = (linhas: string[]) => Buffer.from(linhas.join("\n"), "utf8");
const hoje = new Date("2026-11-21T00:00:00Z");

describe("leitura da planilha", () => {
  it("entende ponto e vírgula, cabeçalhos com acento e apelidos", async () => {
    const { linhas, colunasIgnoradas } = await lerPlanilha("c.csv", csv([
      "Tipo;CNPJ;Razão Social;Regime;Cidade;Observação",
      "PJ;11.222.333/0001-81;Padaria X;Simples;São Paulo;qualquer",
    ]));
    expect(linhas[0]).toMatchObject({ tipo: "PJ", documento: "11.222.333/0001-81", nome: "Padaria X", regimeTributario: "Simples", municipio: "São Paulo" });
    expect(colunasIgnoradas).toEqual(["observacao"]);
  });
  it("exige as colunas de documento e nome", async () => {
    await expect(lerPlanilha("c.csv", csv(["nome;email", "x;y"]))).rejects.toThrow(/cpf_cnpj e nome/);
  });
  it("o modelo para download é lido sem erros", async () => {
    const { linhas } = await lerPlanilha("modelo.csv", Buffer.from(modeloCsv()));
    expect(analisarLinhas(linhas, new Set(), hoje)[0].acao).toBe("criar");
  });
});

describe("análise das linhas", () => {
  const base = { nome: "Empresa", documento: "11.222.333/0001-81" };
  it("deduz o tipo pelo documento e traduz o regime", () => {
    const [l] = analisarLinhas([{ ...base, regimeTributario: "Lucro Presumido" }], new Set(), hoje);
    expect(l.acao).toBe("criar");
    expect(l.dados?.pessoa).toMatchObject({ tipo: "PJ", regimeTributario: "LUCRO_PRESUMIDO" });
    expect(l.mensagens[0]).toMatch(/data de hoje/);
    expect(l.dados?.inicioServico).toBe("2026-11-21");
  });
  it("aponta erros por linha sem parar as demais", () => {
    const r = analisarLinhas([
      { nome: "A", documento: "11.222.333/0001-80" },
      { ...base, regimeTributario: "Simplificado demais", email: "sem-arroba" },
      { nome: "Pessoa", documento: "529.982.247-25", regimeTributario: "Simples" },
      { ...base, inicioServico: "31/02/2026" },
    ], new Set(), hoje);
    expect(r[0]).toMatchObject({ numero: 2, acao: "erro" });
    expect(r[0].mensagens.join()).toMatch(/CNPJ inválido/);
    expect(r[1].mensagens.join()).toMatch(/E-mail/);
    expect(r[2].mensagens.join()).toMatch(/pessoa jurídica/);
    expect(r[3].mensagens.join()).toMatch(/Data de início/);
  });
  it("marca repetidos no arquivo e ignora quem já é cliente", () => {
    const r = analisarLinhas([base, base, { nome: "Pessoa", documento: "52998224725" }], new Set([hashDocumento("52998224725")]), hoje);
    expect(r.map((l) => l.acao)).toEqual(["criar", "erro", "ignorar"]);
    expect(r[1].mensagens[0]).toMatch(/linha 2/);
  });
});
