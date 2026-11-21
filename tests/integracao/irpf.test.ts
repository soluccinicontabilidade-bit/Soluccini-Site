import { describe, expect, it } from "vitest";
import { comEscritorio, type Tx } from "@/lib/db";
import { adicionarVinculo, criarCliente } from "@/lib/clientes";
import { baixarParcela, criarContaBancaria, criarTitulo, garantirCategoriasPadrao } from "@/lib/financeiro/financeiro";
import {
  anexarAoItem, criarDeclaracao, dadosDasEmpresas, enviarPeloLink, gerarLinkEnvio, lerLinkEnvio, mudarSituacaoDeclaracao, revogarLinks, salvarTabela, simular, tabelaDoAno,
} from "@/lib/irpf/irpf";
import { REFERENCIA_2026 } from "@/lib/irpf/calculo";
import { cnpjFicticio, novoEscritorio, temBanco } from "./ajuda";

const pdf = (t: string) => ({ nome: `${t}.pdf`, tipo: "application/pdf", conteudo: Buffer.from(`%PDF-1.7 ${t} ${Math.random()}`) });

async function cenario() {
  const e = await novoEscritorio();
  const A = <T,>(fn: (tx: Tx) => Promise<T>) => comEscritorio(e.ctx(e.admin), fn, { timeout: 60000 });
  const a = e.autor(e.admin);
  const ids = await A(async (tx) => {
    const pj = await criarCliente(tx, a, { pessoa: { tipo: "PJ", documento: cnpjFicticio(), nome: "Empresa do Sócio" }, inicioServico: "2026-01-01" });
    if (!pj.ok) throw new Error();
    await adicionarVinculo(tx, a, pj.cliente.id, { documento: "529.982.247-25", nome: "Ana Sócia", tipo: "SOCIO_ADMINISTRADOR", participacao: "100", inicio: "2020-01-01" });
    const socia = await tx.pessoa.findFirstOrThrow({ where: { nome: "Ana Sócia" } });
    return { pjId: pj.cliente.id, sociaId: socia.id };
  });
  return { ...e, ...ids, A, a };
}

describe.skipIf(!temBanco)("IRPF (banco real)", () => {
  it("abre declaração do sócio com checklist; só PF ligada ao cliente; uma por ano", async () => {
    const e = await cenario();
    const d = await e.A((tx) => criarDeclaracao(tx, e.a, { pessoaId: e.sociaId, clienteId: e.pjId, ano: 2026, honorario: "450,00" }));
    expect(await e.A((tx) => tx.itemDocumentoIRPF.count({ where: { declaracaoId: d.id } }))).toBe(13);
    await expect(e.A((tx) => criarDeclaracao(tx, e.a, { pessoaId: e.sociaId, clienteId: e.pjId, ano: 2026 }))).rejects.toThrow(/já tem declaração/);
    const empresa = await e.A((tx) => tx.cliente.findUniqueOrThrow({ where: { id: e.pjId } }));
    await expect(e.A((tx) => criarDeclaracao(tx, e.a, { pessoaId: empresa.pessoaId, clienteId: e.pjId, ano: 2026 }))).rejects.toThrow(/pessoa física/);
    // tabela de 2026 criada com os valores de referência, ainda não confirmada
    const t = await e.A((tx) => tabelaDoAno(tx, e.escritorioId, 2026));
    expect(t?.confirmada).toBe(false);
  });

  it("link público: lê sem login, recebe arquivo, marca o item e expira ao revogar", async () => {
    const e = await cenario();
    const d = await e.A((tx) => criarDeclaracao(tx, e.a, { pessoaId: e.sociaId, clienteId: e.pjId, ano: 2026 }));
    const token = await e.A((tx) => gerarLinkEnvio(tx, e.a, d.id));
    const pagina = await lerLinkEnvio(token);
    expect(pagina).toMatchObject({ primeiroNome: "Ana", ano: 2026 });
    expect(JSON.stringify(pagina)).not.toMatch(/529|982/); // nada de CPF na página pública
    await enviarPeloLink(token, pagina!.itens[0].id, pdf("informe"));
    const item = await e.A((tx) => tx.itemDocumentoIRPF.findUniqueOrThrow({ where: { id: pagina!.itens[0].id } }));
    expect(item.situacao).toBe("RECEBIDO");
    expect(item.documentoId).toBeTruthy();
    expect((await e.A((tx) => tx.declaracaoIRPF.findUniqueOrThrow({ where: { id: d.id } }))).ultimoContatoEm).toBeTruthy();
    expect(await lerLinkEnvio("token-que-nao-existe")).toBeNull();
    await e.A((tx) => revogarLinks(tx, e.a, d.id));
    expect(await lerLinkEnvio(token)).toBeNull();
    await expect(enviarPeloLink(token, pagina!.itens[1].id, pdf("x"))).rejects.toThrow(/expirou/);
  });

  it("pró-labore e lucros pagos pela empresa aparecem no IRPF do sócio com a origem", async () => {
    const e = await cenario();
    await e.A(async (tx) => {
      await garantirCategoriasPadrao(tx, e.a, e.pjId);
      const conta = await criarContaBancaria(tx, e.a, e.pjId, { nome: "Banco", tipo: "CORRENTE", saldoInicial: "100.000,00", dataSaldoInicial: "2026-01-01" });
      const cat = async (n: string) => (await tx.categoriaFinanceira.findFirstOrThrow({ where: { clienteId: e.pjId, nome: n } })).id;
      for (const [desc, n, valor, mes] of [["Pró-labore jan", "Pró-labore", "5.000,00", "01"], ["Pró-labore fev", "Pró-labore", "5.000,00", "02"], ["Lucros 2025", "Distribuição de lucros", "20.000,00", "03"], ["Aluguel", "Aluguel", "3.000,00", "03"]] as const) {
        const [t] = await criarTitulo(tx, e.a, e.pjId, { tipo: "PAGAR", descricao: desc, favorecido: "Ana Sócia", documentoFavorecido: desc === "Aluguel" ? undefined : "52998224725", competencia: `2026-${mes}`, valor, primeiroVencimento: `2026-${mes}-10`, categoriaId: await cat(n) });
        const p = await tx.parcela.findFirstOrThrow({ where: { tituloId: t.id } });
        await baixarParcela(tx, e.a, e.pjId, p.id, { data: `2026-${mes}-10`, contaId: conta.id });
      }
    });
    const v = await e.A((tx) => dadosDasEmpresas(tx, e.sociaId, 2026));
    expect(v.map((x) => [x.tipo, x.valor])).toEqual([["PRO_LABORE", 500000n], ["PRO_LABORE", 500000n], ["DISTRIBUICAO_LUCROS", 2000000n]]);
    expect(v[0].empresa).toBe("Empresa do Sócio");
  });

  it("simulação guarda o melhor modelo e o funil exige recibo para transmitir; retificadora volta para digitação", async () => {
    const e = await cenario();
    const d = await e.A((tx) => criarDeclaracao(tx, e.a, { pessoaId: e.sociaId, clienteId: e.pjId, ano: 2026 }));
    const r = await e.A((tx) => simular(tx, e.a, d.id, { rendimentosTributaveis: "120.000,00", previdenciaOficial: "9.000,00", dependentes: "1", despesasMedicas: "15.000,00", instrucao: "4.000,00", pgbl: "", pensaoAlimenticia: "", impostoRetido: "18.000,00", rendimentosTotais: "" }));
    expect(r.avisos[0]).toMatch(/não foi confirmada/);
    const salva = await e.A((tx) => tx.declaracaoIRPF.findUniqueOrThrow({ where: { id: d.id } }));
    expect(salva.modelo).toBe(r.melhor);
    await expect(e.A((tx) => mudarSituacaoDeclaracao(tx, e.a, d.id, { para: "TRANSMITIDA" }))).rejects.toThrow(/recibo/);
    await e.A((tx) => mudarSituacaoDeclaracao(tx, e.a, d.id, { para: "TRANSMITIDA", recibo: "12.34.56.78.90-12", transmitidaEm: "2027-04-20", resultado: "-1.234,56" }));
    await e.A((tx) => mudarSituacaoDeclaracao(tx, e.a, d.id, { para: "EM_DIGITACAO", retificar: true }));
    const ret = await e.A((tx) => tx.declaracaoIRPF.findUniqueOrThrow({ where: { id: d.id } }));
    expect(ret).toMatchObject({ situacao: "EM_DIGITACAO", retificadora: true, retificacoes: 1, resultadoCentavos: -123456n });
    // Anexo pelo escritório
    const item = await e.A((tx) => tx.itemDocumentoIRPF.findFirstOrThrow({ where: { declaracaoId: d.id, categoria: "SAUDE" } }));
    await e.A((tx) => anexarAoItem(tx, e.a, d.id, item.id, pdf("recibo-medico")));
  });

  it("só o administrador edita a tabela e confirmar exige fonte", async () => {
    const e = await cenario();
    const json = JSON.stringify(REFERENCIA_2026);
    await expect(comEscritorio(e.ctx(e.contador), (tx) => salvarTabela(tx, e.autor(e.contador), 2027, { parametros: json, confirmada: false, fonte: "" }))).rejects.toThrow(/administrador/);
    await expect(e.A((tx) => salvarTabela(tx, e.a, 2027, { parametros: json, confirmada: true, fonte: "" }))).rejects.toThrow(/fonte/);
    await e.A((tx) => salvarTabela(tx, e.a, 2027, { parametros: json, confirmada: true, fonte: "IN RFB (exemplo de teste)", prazoEntrega: "2028-05-31" }));
    expect((await e.A((tx) => tabelaDoAno(tx, e.escritorioId, 2027)))?.confirmada).toBe(true);
  });
});
