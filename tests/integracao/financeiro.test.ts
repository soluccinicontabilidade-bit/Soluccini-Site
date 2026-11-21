import { describe, expect, it } from "vitest";
import { comEscritorio, type Tx } from "@/lib/db";
import { criarCliente } from "@/lib/clientes";
import { copiarPlanoParaCliente, garantirModeloPadrao } from "@/lib/contabil/plano";
import { criarLancamento, lerCompetencia } from "@/lib/contabil/lancamentos";
import { carregarBase, mudarSituacaoPeriodo } from "@/lib/contabil/periodos";
import { balanceteFecha } from "@/lib/contabil/relatorios";
import { dataCivil } from "@/lib/br";
import { gerarHashSenha } from "@/lib/auth/senha";
import {
  baixarParcela, cancelarTitulo, criarContaBancaria, criarTitulo, criarTransferencia, decidirAprovacao, estornarBaixa,
  garantirCategoriasPadrao, pedirAprovacao, saldoDaConta,
} from "@/lib/financeiro/financeiro";
import { importarExtrato } from "@/lib/financeiro/ofx";
import { aplicarRegras, conciliar, divergencias, fecharConciliacao, lancarDaTransacao, reabrirConciliacao, sugerir } from "@/lib/financeiro/conciliacao";
import { sincronizarContabil } from "@/lib/financeiro/integracao";
import { aging, dreGerencial, fluxoRealizado } from "@/lib/financeiro/relatorios";
import { cnpjFicticio, novoEscritorio, temBanco } from "./ajuda";

const ofx = (linhas: [string, string, string, string?][], saldo?: string) => Buffer.from(`OFXHEADER:100\n<OFX><BANKACCTFROM><BANKID>0341<ACCTID>999</BANKACCTFROM><BANKTRANLIST>${linhas
  .map(([d, v, memo, fitid]) => `<STMTTRN><TRNTYPE>X<DTPOSTED>${d}<TRNAMT>${v}${fitid ? `<FITID>${fitid}` : ""}<MEMO>${memo}</STMTTRN>`).join("")}</BANKTRANLIST>${saldo ? `<LEDGERBAL><BALAMT>${saldo}<DTASOF>20260331</LEDGERBAL>` : ""}</OFX>`);

async function cenario() {
  const e = await novoEscritorio();
  const r = await comEscritorio(e.ctx(e.admin), async (tx) => {
    const modelo = await garantirModeloPadrao(tx, e.escritorioId);
    const c = await criarCliente(tx, e.autor(e.admin), { pessoa: { tipo: "PJ", documento: cnpjFicticio(), nome: "Loja BPO" }, inicioServico: "2026-01-01" });
    if (!c.ok) throw new Error();
    await copiarPlanoParaCliente(tx, e.autor(e.admin), c.cliente.id, modelo.id);
    await garantirCategoriasPadrao(tx, e.autor(e.admin), c.cliente.id);
    const bancoCc = await tx.contaContabil.findFirstOrThrow({ where: { plano: { clienteId: c.cliente.id }, codigo: "1.1.1.02" } });
    const conta = await criarContaBancaria(tx, e.autor(e.admin), c.cliente.id, { nome: "Itaú", tipo: "CORRENTE", numero: "999", saldoInicial: "10.000,00", dataSaldoInicial: "2026-03-01", contaContabilId: bancoCc.id });
    const cat = async (nome: string) => (await tx.categoriaFinanceira.findFirstOrThrow({ where: { clienteId: c.cliente.id, nome } })).id;
    return { clienteId: c.cliente.id, contaId: conta.id, aluguel: await cat("Aluguel"), vendas: await cat("Prestação de serviços"), tarifas: await cat("Tarifas bancárias"), energia: await cat("Energia elétrica") };
  }, { timeout: 60000 });
  return { ...e, ...r, A: <T,>(fn: (tx: Tx) => Promise<T>) => comEscritorio(e.ctx(e.admin), fn, { timeout: 60000 }) };
}

describe.skipIf(!temBanco)("financeiro, conciliação e contabilidade (banco real)", () => {
  it("título com rateio e parcelas: somas conferidas, recorrência e cancelamento", async () => {
    const e = await cenario();
    const a = e.autor(e.admin);
    await e.A(async (tx) => {
      const [t] = await criarTitulo(tx, a, e.clienteId, {
        tipo: "PAGAR", descricao: "Conta de luz e aluguel", competencia: "2026-03", valor: "1.000,00", primeiroVencimento: "2026-03-10", parcelas: 3,
        rateios: [{ categoriaId: e.aluguel, valor: "700,00" }, { categoriaId: e.energia, valor: "300,00" }],
      });
      const ps = await tx.parcela.findMany({ where: { tituloId: t.id }, orderBy: { numero: "asc" } });
      expect(ps.map((p) => p.valorCentavos)).toEqual([33333n, 33333n, 33334n]);
      expect(ps.map((p) => p.vencimento.toISOString().slice(0, 10))).toEqual(["2026-03-10", "2026-04-10", "2026-05-10"]);
      await expect(criarTitulo(tx, a, e.clienteId, { tipo: "PAGAR", descricao: "x", competencia: "2026-03", valor: "100,00", primeiroVencimento: "2026-03-10", rateios: [{ categoriaId: e.aluguel, valor: "90,00" }] })).rejects.toThrow(/soma dos rateios/);
      await expect(criarTitulo(tx, a, e.clienteId, { tipo: "RECEBER", descricao: "x", competencia: "2026-03", valor: "100,00", primeiroVencimento: "2026-03-10", categoriaId: e.aluguel })).rejects.toThrow(/é de despesa/);
      const rec = await criarTitulo(tx, a, e.clienteId, { tipo: "PAGAR", descricao: "Internet", competencia: "2026-03", valor: "120,00", primeiroVencimento: "2026-03-15", categoriaId: e.energia, repetirMeses: 2 });
      expect(rec).toHaveLength(3);
      await cancelarTitulo(tx, a, e.clienteId, rec[2].id, "Serviço cancelado");
      expect((await tx.parcela.findFirstOrThrow({ where: { tituloId: rec[2].id } })).situacao).toBe("CANCELADA");
    });
  });

  it("aprovação: com aprovador cadastrado, pagamento só baixa depois de aprovado", async () => {
    const e = await cenario();
    const a = e.autor(e.admin);
    const aprovador = await e.A(async (tx) => {
      const u = await tx.usuario.create({ data: { escritorioId: e.escritorioId, nome: "Dona da loja", email: `dona-${Date.now()}@teste.local`, perfil: "CLIENTE_APROVADOR", senhaHash: await gerarHashSenha("senha de teste muito boa") } });
      await tx.acessoCliente.create({ data: { usuarioId: u.id, clienteId: e.clienteId, escritorioId: e.escritorioId } });
      return u;
    });
    await e.A(async (tx) => {
      const [t] = await criarTitulo(tx, a, e.clienteId, { tipo: "PAGAR", descricao: "Fornecedor X", competencia: "2026-03", valor: "500,00", primeiroVencimento: "2026-03-20", categoriaId: e.aluguel });
      const p = await tx.parcela.findFirstOrThrow({ where: { tituloId: t.id } });
      await expect(baixarParcela(tx, a, e.clienteId, p.id, { data: "2026-03-20", contaId: e.contaId })).rejects.toThrow(/aprova/);
      await pedirAprovacao(tx, a, e.clienteId, [p.id]);
      await expect(decidirAprovacao(tx, a, e.clienteId, p.id, true)).rejects.toThrow(/aprovador/);
      const autorAprovador = { id: aprovador.id, escritorioId: e.escritorioId, perfil: aprovador.perfil };
      await expect(decidirAprovacao(tx, autorAprovador, e.clienteId, p.id, false)).rejects.toThrow(/Explique/);
      await decidirAprovacao(tx, autorAprovador, e.clienteId, p.id, true);
      const v = await baixarParcela(tx, a, e.clienteId, p.id, { data: "2026-03-21", contaId: e.contaId, juros: "2,50", multa: "10,00" });
      expect(v).toBe(51250n);
      expect(await saldoDaConta(tx, e.contaId, dataCivil("2026-03-31"))).toBe(1000000n - 51250n);
      await estornarBaixa(tx, a, e.clienteId, p.id);
      expect((await tx.parcela.findUniqueOrThrow({ where: { id: p.id } })).situacao).toBe("APROVADA");
    });
  });

  it("extrato OFX: importa, não duplica ao reimportar período sobreposto e confere a conta", async () => {
    const e = await cenario();
    const a = e.autor(e.admin);
    const r1 = await e.A((tx) => importarExtrato(tx, a, e.clienteId, e.contaId, { nome: "marco.ofx", conteudo: ofx([["20260305", "-4500.00", "PIX IMOBILIARIA BOA VISTA", "F1"], ["20260310", "-89.90", "TARIFA PACOTE"], ["20260228", "-1.00", "antes do saldo inicial"]]) }));
    expect(r1).toMatchObject({ novas: 2, repetidas: 0, anteriores: 1 });
    const r2 = await e.A((tx) => importarExtrato(tx, a, e.clienteId, e.contaId, { nome: "marco2.ofx", conteudo: ofx([["20260305", "-4500.00", "PIX IMOBILIARIA BOA VISTA", "F1"], ["20260310", "-89.90", "TARIFA PACOTE"], ["20260315", "2000.00", "TED CLIENTE SOL"]]) }));
    expect(r2).toMatchObject({ novas: 1, repetidas: 2 });
    await expect(e.A((tx) => importarExtrato(tx, a, e.clienteId, e.contaId, { nome: "marco2.ofx", conteudo: ofx([["20260305", "-4500.00", "PIX IMOBILIARIA BOA VISTA", "F1"], ["20260310", "-89.90", "TARIFA PACOTE"], ["20260315", "2000.00", "TED CLIENTE SOL"]]) }))).rejects.toThrow(/já foi importado/);
    const outraConta = Buffer.from(ofx([["20260305", "-1", "x"]]).toString().replace("<ACCTID>999", "<ACCTID>55555"));
    await expect(e.A((tx) => importarExtrato(tx, a, e.clienteId, e.contaId, { nome: "x.ofx", conteudo: outraConta }))).rejects.toThrow(/conta 55555/);
  });

  it("conciliação completa: automática, N:1, ajuste de juros, lançar da transação com regra, fechar e reabrir", async () => {
    const e = await cenario();
    const a = e.autor(e.admin);
    await e.A(async (tx) => {
      await criarTitulo(tx, a, e.clienteId, { tipo: "PAGAR", descricao: "Aluguel março", favorecido: "Imobiliária Boa Vista", competencia: "2026-03", valor: "4.500,00", primeiroVencimento: "2026-03-05", categoriaId: e.aluguel });
      await criarTitulo(tx, a, e.clienteId, { tipo: "RECEBER", descricao: "Serviço A", favorecido: "Cliente Sol", competencia: "2026-03", valor: "1.200,00", primeiroVencimento: "2026-03-15", categoriaId: e.vendas });
      await criarTitulo(tx, a, e.clienteId, { tipo: "RECEBER", descricao: "Serviço B", favorecido: "Cliente Sol", competencia: "2026-03", valor: "800,00", primeiroVencimento: "2026-03-15", categoriaId: e.vendas });
      await criarTitulo(tx, a, e.clienteId, { tipo: "PAGAR", descricao: "Energia", competencia: "2026-03", valor: "300,00", primeiroVencimento: "2026-03-20", categoriaId: e.energia });
    });
    await e.A((tx) => importarExtrato(tx, a, e.clienteId, e.contaId, { nome: "m.ofx", conteudo: ofx([
      ["20260305", "-4500.00", "PIX ENVIADO IMOBILIARIA BOA VISTA", "T1"],
      ["20260315", "2000.00", "TED CLIENTE SOL", "T2"],
      ["20260322", "-306.00", "PAGTO CONCESSIONARIA ENERGIA", "T3"],
      ["20260328", "-89.90", "TARIFA PACOTE SERVICOS", "T4"],
    ], "7104.10") }));
    const s = await e.A((tx) => sugerir(tx, a, e.clienteId, e.contaId));
    expect(s.automaticas).toBe(1); // aluguel: valor, data e texto batem
    const trs = await e.A((tx) => tx.transacaoBancaria.findMany({ where: { contaBancariaId: e.contaId }, orderBy: { data: "asc" } }));
    expect(trs[0].situacao).toBe("CONCILIADA");
    // N:1: uma TED paga dois títulos.
    const [pa, pb] = await e.A((tx) => tx.parcela.findMany({ where: { clienteId: e.clienteId, titulo: { favorecido: { nome: "Cliente Sol" } } }, orderBy: { valorCentavos: "desc" } }));
    await e.A((tx) => conciliar(tx, a, e.clienteId, e.contaId, { transacoes: [trs[1].id], parcelas: [pa.id, pb.id], transferencias: [] }));
    // Energia paga com R$ 6,00 a mais: só concilia com ajuste de juros.
    const energia = await e.A((tx) => tx.parcela.findFirstOrThrow({ where: { clienteId: e.clienteId, titulo: { descricao: "Energia" } } }));
    await expect(e.A((tx) => conciliar(tx, a, e.clienteId, e.contaId, { transacoes: [trs[2].id], parcelas: [energia.id], transferencias: [] }))).rejects.toThrow(/diferença R\$ -6,00|diferença -R\$ 6,00/);
    await e.A((tx) => conciliar(tx, a, e.clienteId, e.contaId, { transacoes: [trs[2].id], parcelas: [energia.id], transferencias: [] }, { ajuste: "juros" }));
    expect((await e.A((tx) => tx.parcela.findUniqueOrThrow({ where: { id: energia.id } }))).jurosCentavos).toBe(600n);
    // Tarifa sem título: lança direto e aprende a regra.
    await e.A((tx) => lancarDaTransacao(tx, a, e.clienteId, trs[3].id, { categoriaId: e.tarifas, criarRegra: true }));
    // Saldo: 10.000 − 4.500 + 2.000 − 306 − 89,90 = 7.104,10 = saldo do extrato
    const d = await e.A((tx) => divergencias(tx, e.contaId, lerCompetencia("2026-03")));
    expect(d.pendentes).toHaveLength(0);
    expect(d.saldoSistema).toBe(710410n);
    expect(d.saldoExtrato).toBe(710410n);
    await e.A((tx) => fecharConciliacao(tx, a, e.clienteId, e.contaId, lerCompetencia("2026-03")));
    // Mês fechado: novo extrato com transação de março é recusado; baixa em março também.
    await expect(e.A((tx) => importarExtrato(tx, a, e.clienteId, e.contaId, { nome: "n.ofx", conteudo: ofx([["20260330", "-1.00", "x", "T9"]]) }))).rejects.toThrow(/fechada/);
    await expect(e.A((tx) => reabrirConciliacao(tx, a, e.clienteId, e.contaId, lerCompetencia("2026-03"), "erro"))).rejects.toThrow(/contador/);
    await comEscritorio(e.ctx(e.contador), (tx) => reabrirConciliacao(tx, e.autor(e.contador), e.clienteId, e.contaId, lerCompetencia("2026-03"), "Extrato complementar"));
    // Regra aprendida aplicada em abril.
    await e.A((tx) => importarExtrato(tx, a, e.clienteId, e.contaId, { nome: "abr.ofx", conteudo: ofx([["20260428", "-89.90", "TARIFA PACOTE SERVICOS", "T5"]]) }));
    expect(await e.A((tx) => aplicarRegras(tx, a, e.clienteId, e.contaId))).toBe(1);
    const rel = await e.A((tx) => dreGerencial(tx, e.clienteId, dataCivil("2026-03-01"), dataCivil("2026-03-31")));
    expect(rel.linhas.at(-1)!.celulas[1]).toBe(200000n - 450000n - 30000n - 8990n);
    const fluxo = await e.A((tx) => fluxoRealizado(tx, e.clienteId, dataCivil("2026-03-01"), dataCivil("2026-03-31")));
    expect(fluxo.alerta).toBeUndefined();
    const ag = await e.A((tx) => aging(tx, e.clienteId, dataCivil("2026-03-31")));
    expect(ag.linhas.at(-1)!.celulas[3]).toBe("0");
  });

  it("contabiliza o financeiro (competência), estorna o que muda e o fechamento contábil exige a conciliação", async () => {
    const e = await cenario();
    const a = e.autor(e.admin);
    const mar = lerCompetencia("2026-03");
    await e.A(async (tx) => {
      const cc = async (codigo: string) => (await tx.contaContabil.findFirstOrThrow({ where: { plano: { clienteId: e.clienteId }, codigo } })).id;
      await tx.configFinanceira.create({ data: { clienteId: e.clienteId, escritorioId: e.escritorioId, contaFornecedoresId: await cc("2.1.1.01"), contaClientesId: await cc("1.1.2.01"), contaJurosPagosId: await cc("5.2.1.02") } });
      await tx.categoriaFinanceira.update({ where: { id: e.aluguel }, data: { contaContabilId: await cc("5.1.2.01") } });
      await tx.categoriaFinanceira.update({ where: { id: e.vendas }, data: { contaContabilId: await cc("3.1.1.03") } });
      // saldo inicial da conta também na contabilidade
      await criarLancamento(tx, a, e.clienteId, { data: "2026-03-01", historico: "Saldo inicial", origem: "SALDO_INICIAL", partidas: [{ conta: "1.1.1.02", tipo: "DEBITO", valor: "10.000,00" }, { conta: "2.3.1.01", tipo: "CREDITO", valor: "10.000,00" }] });
      const [t] = await criarTitulo(tx, a, e.clienteId, { tipo: "PAGAR", descricao: "Aluguel", competencia: "2026-03", valor: "4.500,00", primeiroVencimento: "2026-03-05", categoriaId: e.aluguel });
      const p = await tx.parcela.findFirstOrThrow({ where: { tituloId: t.id } });
      await baixarParcela(tx, a, e.clienteId, p.id, { data: "2026-03-06", contaId: e.contaId, juros: "45,00" });
      await criarTitulo(tx, a, e.clienteId, { tipo: "RECEBER", descricao: "Serviço", competencia: "2026-03", valor: "2.000,00", primeiroVencimento: "2026-04-10", categoriaId: e.vendas });
    });
    const r1 = await e.A((tx) => sincronizarContabil(tx, a, e.clienteId, mar));
    expect(r1).toMatchObject({ criados: 3, estornados: 0, pendencias: [] }); // 2 emissões + 1 baixa
    expect(await e.A((tx) => sincronizarContabil(tx, a, e.clienteId, mar))).toMatchObject({ criados: 0, estornados: 0 }); // idempotente
    // Cancelar o recebível estorna a provisão.
    await e.A(async (tx) => {
      const t = await tx.tituloFinanceiro.findFirstOrThrow({ where: { clienteId: e.clienteId, descricao: "Serviço" } });
      await cancelarTitulo(tx, a, e.clienteId, t.id, "Cliente desistiu");
    });
    expect(await e.A((tx) => sincronizarContabil(tx, a, e.clienteId, mar))).toMatchObject({ criados: 0, estornados: 1 });
    const { contas, partidas } = await e.A((tx) => carregarBase(tx, e.clienteId, dataCivil("2026-03-31")));
    expect(balanceteFecha(contas, partidas, dataCivil("2026-03-31"))).toBe(true);
    const banco = contas.find((c) => c.codigo === "1.1.1.02")!;
    expect(partidas.filter((p) => p.contaId === banco.id).reduce((s, p) => s + (p.tipo === "DEBITO" ? p.valor : -p.valor), 0n)).toBe(1000000n - 454500n);
    // Fechamento contábil: a conta ligada ao banco exige a conciliação fechada.
    const C = <T,>(fn: (tx: Tx) => Promise<T>) => comEscritorio(e.ctx(e.contador), fn);
    await C((tx) => mudarSituacaoPeriodo(tx, e.autor(e.contador), e.clienteId, { competencia: mar, para: "EM_CONFERENCIA" }));
    await expect(C((tx) => mudarSituacaoPeriodo(tx, e.autor(e.contador), e.clienteId, { competencia: mar, para: "FECHADO" }))).rejects.toThrow(/conciliação bancária do mês de: Itaú/);
  });

  it("transferência entre contas entra no saldo das duas e na contabilidade como banco contra banco", async () => {
    const e = await cenario();
    const a = e.autor(e.admin);
    await e.A(async (tx) => {
      const cx = await tx.contaContabil.findFirstOrThrow({ where: { plano: { clienteId: e.clienteId }, codigo: "1.1.1.01" } });
      const caixa = await criarContaBancaria(tx, a, e.clienteId, { nome: "Caixa", tipo: "CAIXA", saldoInicial: "0", dataSaldoInicial: "2026-03-01", contaContabilId: cx.id });
      await criarTransferencia(tx, a, e.clienteId, { origemId: e.contaId, destinoId: caixa.id, data: "2026-03-10", valor: "500,00" });
      expect(await saldoDaConta(tx, caixa.id, dataCivil("2026-03-31"))).toBe(50000n);
      expect(await saldoDaConta(tx, e.contaId, dataCivil("2026-03-31"))).toBe(950000n);
    });
    expect((await e.A((tx) => sincronizarContabil(tx, a, e.clienteId, lerCompetencia("2026-03")))).criados).toBe(1);
  });
});
