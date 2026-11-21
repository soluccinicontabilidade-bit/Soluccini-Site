import { describe, expect, it } from "vitest";
import { comEscritorio } from "@/lib/db";
import { criarCliente } from "@/lib/clientes";
import { enviarDocumento, enviarNovaVersao } from "@/lib/documentos";
import { lerArquivo } from "@/lib/armazenamento";
import { aplicarImportacaoClientes, receberImportacaoClientes } from "@/lib/importacao";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cnpjFicticio, novoEscritorio, temBanco } from "./ajuda";

const pdf = (texto: string) => ({ nome: "certidao.pdf", tipo: "application/pdf", conteudo: Buffer.from(`%PDF-1.7 ${texto}`) });

describe.skipIf(!temBanco)("documentos (banco real)", () => {
  it("guarda cifrado, versiona e recusa o mesmo arquivo duas vezes", async () => {
    const e = await novoEscritorio();
    const r = await comEscritorio(e.ctx(e.admin), async (tx) => {
      const c = await criarCliente(tx, e.autor(e.admin), { pessoa: { tipo: "PJ", documento: cnpjFicticio(), nome: "Com docs" }, inicioServico: "2026-01-01" });
      if (!c.ok) throw new Error();
      const cat = await tx.categoriaDocumento.findFirstOrThrow({ where: { nome: "Certidão negativa federal" } });
      await expect(enviarDocumento(tx, e.autor(e.admin), c.cliente.id, { categoriaId: cat.id, titulo: "", arquivo: pdf("v1") })).rejects.toThrow(/validade/);
      const doc = await enviarDocumento(tx, e.autor(e.admin), c.cliente.id, { categoriaId: cat.id, titulo: "", validoAte: "2026-12-31", arquivo: pdf("v1") });
      await expect(enviarDocumento(tx, e.autor(e.admin), c.cliente.id, { categoriaId: cat.id, titulo: "x", validoAte: "2026-12-31", arquivo: pdf("v1") })).rejects.toThrow(/já foi enviado/);
      await enviarNovaVersao(tx, e.autor(e.admin), c.cliente.id, doc.id, pdf("v2"), "2027-06-30");
      return tx.documento.findUniqueOrThrow({ where: { id: doc.id }, include: { versoes: { orderBy: { versao: "asc" } } } });
    });
    expect(r.titulo).toBe("Certidão negativa federal");
    expect(r.versoes.map((v) => v.versao)).toEqual([1, 2]);
    expect(r.validoAte?.toISOString().slice(0, 10)).toBe("2027-06-30");
    // No disco o arquivo está cifrado; lido pela aplicação volta ao original.
    const cru = await readFile(path.join(process.env.ARMAZENAMENTO_DIR!, r.versoes[1].chaveArquivo));
    expect(cru.includes(Buffer.from("%PDF"))).toBe(false);
    expect((await lerArquivo(r.versoes[1].chaveArquivo)).toString()).toBe("%PDF-1.7 v2");
  });
});

describe.skipIf(!temBanco)("importação de clientes (banco real)", () => {
  it("analisa, aplica uma vez e recusa a mesma planilha de novo", async () => {
    const e = await novoEscritorio();
    const [a, b] = [cnpjFicticio(), cnpjFicticio()];
    const planilha = Buffer.from(`cpf_cnpj;nome;regime;inicio_servico\n${a};Empresa A;Simples;01/02/2026\n${b};Empresa B;Real;\n52998224725;Pessoa F;;01/03/2026\n`);
    const imp = await comEscritorio(e.ctx(e.admin), (tx) => receberImportacaoClientes(tx, e.autor(e.admin), { nome: "clientes.csv", conteudo: planilha }));
    expect(imp.situacao).toBe("PRONTA");
    expect(imp.resumo).toMatchObject({ criar: 3, ignorar: 0, erros: 0 });
    expect(await comEscritorio(e.ctx(e.admin), (tx) => tx.cliente.count())).toBe(0); // nada gravado ainda

    const r = await comEscritorio(e.ctx(e.admin), (tx) => aplicarImportacaoClientes(tx, e.autor(e.admin), imp.id), { timeout: 60000 });
    expect(r.criados).toBe(3);
    const clientes = await comEscritorio(e.ctx(e.admin), (tx) => tx.cliente.findMany({ include: { pessoa: true }, orderBy: { codigo: "asc" } }));
    expect(clientes.map((c) => [c.codigo, c.pessoa.nome, c.pessoa.regimeTributario])).toEqual([
      [1, "Empresa A", "SIMPLES_NACIONAL"], [2, "Empresa B", "LUCRO_REAL"], [3, "Pessoa F", null],
    ]);
    await expect(comEscritorio(e.ctx(e.admin), (tx) => receberImportacaoClientes(tx, e.autor(e.admin), { nome: "clientes.csv", conteudo: planilha }))).rejects.toThrow(/já foi importada/);

    // Outra planilha com os mesmos clientes: todos ignorados.
    const de_novo = await comEscritorio(e.ctx(e.admin), (tx) => receberImportacaoClientes(tx, e.autor(e.admin), { nome: "outra.csv", conteudo: Buffer.concat([planilha, Buffer.from("\n")]) }));
    expect(de_novo.resumo).toMatchObject({ criar: 0, ignorar: 3 });
  });

  it("com erro em uma linha, a importação fica parada e nada entra", async () => {
    const e = await novoEscritorio();
    const planilha = Buffer.from(`cpf_cnpj;nome\n${cnpjFicticio()};Boa\n11.222.333/0001-80;Ruim\n`);
    const imp = await comEscritorio(e.ctx(e.admin), (tx) => receberImportacaoClientes(tx, e.autor(e.admin), { nome: "c.csv", conteudo: planilha }));
    expect(imp.situacao).toBe("COM_ERROS");
    await expect(comEscritorio(e.ctx(e.admin), (tx) => aplicarImportacaoClientes(tx, e.autor(e.admin), imp.id))).rejects.toThrow(/não está pronta/);
    expect(await comEscritorio(e.ctx(e.admin), (tx) => tx.cliente.count())).toBe(0);
  });
});
