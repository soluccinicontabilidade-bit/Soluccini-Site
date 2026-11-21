import { describe, expect, it } from "vitest";
import { comEscritorio } from "@/lib/db";
import { criarCliente } from "@/lib/clientes";
import { copiarPlanoParaCliente, criarConta, garantirModeloPadrao, importarPlano, criarPlanoVazio } from "@/lib/contabil/plano";
import { aplicarSaldosIniciais, criarLancamento, editarLancamento, estornarLancamento, lerCompetencia } from "@/lib/contabil/lancamentos";
import { apurarResultado, carregarBase, contasQuePedemJustificativa, mudarSituacaoPeriodo } from "@/lib/contabil/periodos";
import { balanco, dre } from "@/lib/contabil/relatorios";
import { dataCivil } from "@/lib/br";
import { cnpjFicticio, novoEscritorio, temBanco } from "./ajuda";

async function clienteComPlano() {
  const e = await novoEscritorio();
  const clienteId = await comEscritorio(e.ctx(e.admin), async (tx) => {
    const modelo = await garantirModeloPadrao(tx, e.escritorioId);
    const r = await criarCliente(tx, e.autor(e.admin), { pessoa: { tipo: "PJ", documento: cnpjFicticio(), nome: "Contábil Ltda" }, inicioServico: "2026-01-01" });
    if (!r.ok) throw new Error();
    await copiarPlanoParaCliente(tx, e.autor(e.admin), r.cliente.id, modelo.id);
    return r.cliente.id;
  }, { timeout: 60000 });
  return { ...e, clienteId };
}

const venda = (data: string, valor = "1.000,00") => ({
  data, historico: "Venda à vista",
  partidas: [{ conta: "1.1.1.02", tipo: "DEBITO" as const, valor }, { conta: "3.1.1.01", tipo: "CREDITO" as const, valor }],
});

describe.skipIf(!temBanco)("contabilidade (banco real)", () => {
  it("modelo padrão é criado uma vez e copiado com a hierarquia (PL fora do passivo)", async () => {
    const e = await clienteComPlano();
    const contas = await comEscritorio(e.ctx(e.admin), (tx) => tx.contaContabil.findMany({ where: { plano: { clienteId: e.clienteId } }, include: { pai: true } }));
    const pl = contas.find((c) => c.codigo === "2.3")!;
    expect(pl.paiId).toBeNull();
    expect(contas.find((c) => c.codigo === "2.3.1.01")!.pai!.codigo).toBe("2.3.1");
    expect(contas.find((c) => c.codigo === "1.1.1.02")!.disponivel).toBe(true);
    const modelos = await comEscritorio(e.ctx(e.admin), async (tx) => { await garantirModeloPadrao(tx, e.escritorioId); return tx.planoDeContas.count({ where: { clienteId: null } }); });
    expect(modelos).toBe(1);
  });

  it("lança com número sequencial e recusa desequilíbrio e conta sintética com mensagem clara", async () => {
    const e = await clienteComPlano();
    await comEscritorio(e.ctx(e.admin), async (tx) => {
      const a = await criarLancamento(tx, e.autor(e.admin), e.clienteId, venda("2026-01-10"));
      const b = await criarLancamento(tx, e.autor(e.admin), e.clienteId, venda("2026-01-11"));
      expect([a.numero, b.numero]).toEqual([1, 2]);
      await expect(criarLancamento(tx, e.autor(e.admin), e.clienteId, { ...venda("2026-01-12"), partidas: [{ conta: "1.1.1.02", tipo: "DEBITO", valor: "10,00" }, { conta: "3.1.1.01", tipo: "CREDITO", valor: "9,99" }] }))
        .rejects.toThrow(/Diferença: R\$ 0,01/);
      await expect(criarLancamento(tx, e.autor(e.admin), e.clienteId, { ...venda("2026-01-12"), partidas: [{ conta: "1.1.1", tipo: "DEBITO", valor: "10,00" }, { conta: "3.1.1.01", tipo: "CREDITO", valor: "10,00" }] }))
        .rejects.toThrow(/sintética/);
      await expect(criarLancamento(tx, e.autor(e.admin), e.clienteId, { ...venda("2026-01-12"), origem: "AJUSTE" })).rejects.toThrow(/justificativa/);
    });
  });

  it("ciclo do período: conferência trava, fechamento exige justificativa do caixa e ordem dos meses", async () => {
    const e = await clienteComPlano();
    const jan = lerCompetencia("2026-01"), fev = lerCompetencia("02/2026");
    await comEscritorio(e.ctx(e.admin), async (tx) => {
      await criarLancamento(tx, e.autor(e.admin), e.clienteId, venda("2026-01-10"));
      await criarLancamento(tx, e.autor(e.admin), e.clienteId, venda("2026-02-10"));
    });
    const bpo = { ...e.autor(e.bpo) };
    // Analista manda para conferência; ninguém lança mais em janeiro.
    await comEscritorio(e.ctx(e.admin), (tx) => mudarSituacaoPeriodo(tx, e.autor(e.admin), e.clienteId, { competencia: jan, para: "EM_CONFERENCIA" }));
    await expect(comEscritorio(e.ctx(e.admin), (tx) => criarLancamento(tx, e.autor(e.admin), e.clienteId, venda("2026-01-20")))).rejects.toThrow(/em conferência/);
    // Administrador não fecha; só o contador.
    await expect(comEscritorio(e.ctx(e.admin), (tx) => mudarSituacaoPeriodo(tx, e.autor(e.admin), e.clienteId, { competencia: jan, para: "FECHADO" }))).rejects.toThrow(/contador/);
    const C = (fn: Parameters<typeof comEscritorio>[1]) => comEscritorio(e.ctx(e.contador), fn);
    const ctr = e.autor(e.contador);
    // Fevereiro não fecha antes de janeiro.
    await C((tx) => mudarSituacaoPeriodo(tx, ctr, e.clienteId, { competencia: fev, para: "EM_CONFERENCIA" }));
    await expect(C((tx) => mudarSituacaoPeriodo(tx, ctr, e.clienteId, { competencia: fev, para: "FECHADO" }))).rejects.toThrow(/Feche antes 01\/2026/);
    // Conta de banco com movimento precisa de justificativa.
    const pendentes = await C((tx) => contasQuePedemJustificativa(tx, e.clienteId, jan));
    expect(pendentes.map((p) => p.conta.codigo)).toEqual(["1.1.1.02"]);
    await expect(C((tx) => mudarSituacaoPeriodo(tx, ctr, e.clienteId, { competencia: jan, para: "FECHADO" }))).rejects.toThrow(/Justifique o saldo de: 1.1.1.02/);
    await C((tx) => mudarSituacaoPeriodo(tx, ctr, e.clienteId, { competencia: jan, para: "FECHADO", justificativasContas: { [pendentes[0].conta.id]: "Saldo conferido com o extrato" } }));
    await C((tx) => mudarSituacaoPeriodo(tx, ctr, e.clienteId, { competencia: fev, para: "FECHADO", justificativasContas: { [pendentes[0].conta.id]: "Conferido" } }));
    // Reabrir: do mais recente para o mais antigo, com justificativa.
    await expect(C((tx) => mudarSituacaoPeriodo(tx, ctr, e.clienteId, { competencia: jan, para: "ABERTO", justificativa: "x" }))).rejects.toThrow(/Reabra antes 02\/2026/);
    await expect(C((tx) => mudarSituacaoPeriodo(tx, ctr, e.clienteId, { competencia: fev, para: "ABERTO" }))).rejects.toThrow(/Explique/);
    await C((tx) => mudarSituacaoPeriodo(tx, ctr, e.clienteId, { competencia: fev, para: "ABERTO", justificativa: "Nota fiscal esquecida" }));
    void bpo;
    const just = await C((tx) => tx.justificativaFechamento.count({ where: { periodo: { clienteId: e.clienteId } } }));
    expect(just).toBe(2);
  });

  it("edição só com período aberto; estorno inverte e não se repete", async () => {
    const e = await clienteComPlano();
    await comEscritorio(e.ctx(e.admin), async (tx) => {
      const l = await criarLancamento(tx, e.autor(e.admin), e.clienteId, venda("2026-03-10"));
      await editarLancamento(tx, e.autor(e.admin), e.clienteId, l.id, venda("2026-03-11", "1.500,00"));
      const est = await estornarLancamento(tx, e.autor(e.admin), e.clienteId, l.id, "2026-03-31", "Venda cancelada");
      expect(est.origem).toBe("ESTORNO");
      await expect(estornarLancamento(tx, e.autor(e.admin), e.clienteId, l.id, "2026-03-31", "de novo")).rejects.toThrow(/já foi estornado/);
      await expect(editarLancamento(tx, e.autor(e.admin), e.clienteId, l.id, venda("2026-03-11"))).rejects.toThrow(/estornado/);
      const { contas, partidas } = await carregarBase(tx, e.clienteId, dataCivil("2026-03-31"));
      expect(dre(contas, partidas, dataCivil("2026-03-01"), dataCivil("2026-03-31")).resultado).toBe(0n);
    });
  });

  it("saldos iniciais: precisam fechar, entram uma vez e o balanço bate", async () => {
    const e = await clienteComPlano();
    const ruim = Buffer.from("conta;debito;credito\n1.1.1.02;15.000,00;\n2.3.1.01;;14.000,00\n");
    const bom = Buffer.from("conta;debito;credito\n1.1.1.02;15.000,00;\n1.2.3.01;5.000,00;\n2.1.1.01;;5.000,00\n2.3.1.01;;15.000,00\n");
    await comEscritorio(e.ctx(e.admin), async (tx) => {
      await expect(aplicarSaldosIniciais(tx, e.autor(e.admin), e.clienteId, "2026-01-01", { nome: "s.csv", conteudo: ruim })).rejects.toThrow(/Diferença de R\$ 1\.000,00/);
      const l = await aplicarSaldosIniciais(tx, e.autor(e.admin), e.clienteId, "2026-01-01", { nome: "s.csv", conteudo: bom });
      expect(l.origem).toBe("SALDO_INICIAL");
      await expect(aplicarSaldosIniciais(tx, e.autor(e.admin), e.clienteId, "2026-01-01", { nome: "s.csv", conteudo: bom })).rejects.toThrow(/Já existem saldos iniciais/);
      const { contas, partidas } = await carregarBase(tx, e.clienteId, dataCivil("2026-01-31"));
      const b = balanco(contas, partidas, dataCivil("2026-01-31"));
      expect(b.ativo).toBe(2000000n);
      expect(b.passivoMaisPl).toBe(2000000n);
    });
  });

  it("apuração do resultado zera as contas de resultado e leva o lucro ao PL", async () => {
    const e = await clienteComPlano();
    await comEscritorio(e.ctx(e.admin), async (tx) => {
      await criarLancamento(tx, e.autor(e.admin), e.clienteId, venda("2026-05-10", "2.000,00"));
      await criarLancamento(tx, e.autor(e.admin), e.clienteId, { data: "2026-06-10", historico: "Aluguel", partidas: [{ conta: "5.1.2.01", tipo: "DEBITO", valor: "500,00" }, { conta: "1.1.1.02", tipo: "CREDITO", valor: "500,00" }] });
      const destino = await tx.contaContabil.findFirstOrThrow({ where: { codigo: "2.3.3.01", plano: { clienteId: e.clienteId } } });
      const l = await apurarResultado(tx, e.autor(e.admin), e.clienteId, 2026, destino.id);
      expect(l.historico).toMatch(/lucro de 1\.500,00/);
      await expect(apurarResultado(tx, e.autor(e.admin), e.clienteId, 2026, destino.id)).rejects.toThrow(/já foi apurado/);
      const { contas, partidas } = await carregarBase(tx, e.clienteId, dataCivil("2026-12-31"));
      const b = balanco(contas, partidas, dataCivil("2026-12-31"));
      expect(b.resultadoNaoEncerrado).toBe(0n);
      expect(b.passivoMaisPl).toBe(b.ativo);
      expect(dre(contas, partidas, dataCivil("2026-01-01"), dataCivil("2026-12-31")).resultado).toBe(150000n);
      // Estornar a apuração permite refazer.
      await estornarLancamento(tx, e.autor(e.admin), e.clienteId, l.id, "2026-12-31", "Refazer apuração");
      await apurarResultado(tx, e.autor(e.admin), e.clienteId, 2026, destino.id);
    });
  });

  it("importa plano por planilha: herda grupo do pai, ignora existentes e aponta erros", async () => {
    const e = await novoEscritorio();
    await comEscritorio(e.ctx(e.admin), async (tx) => {
      const r = await criarCliente(tx, e.autor(e.admin), { pessoa: { tipo: "PJ", documento: cnpjFicticio(), nome: "Com plano próprio" }, inicioServico: "2026-01-01" });
      if (!r.ok) throw new Error();
      const plano = await criarPlanoVazio(tx, e.autor(e.admin), r.cliente.id);
      const csv = Buffer.from("codigo;nome;tipo;natureza;grupo;disponivel\n1;Ativo;S;D;Ativo;\n1.01;Caixa;A;;;sim\n2.3;Patrimônio;S;C;Patrimônio líquido;\n2.3.01;Capital;A;;;\n9.x;Errada;A;;;\n");
      const a = await importarPlano(tx, e.escritorioId, plano.id, { nome: "p.csv", conteudo: csv }, true);
      expect(a.temErro).toBe(true);
      expect(await tx.contaContabil.count({ where: { planoId: plano.id } })).toBe(0); // com erro, nada entra
      const ok = Buffer.from("codigo;nome;tipo;natureza;grupo;disponivel\n1.01;Caixa;A;;;sim\n1;Ativo;S;D;Ativo;\n2.3;Patrimônio;S;C;Patrimônio líquido;\n2.3.01;Capital;A;;;\n");
      const b = await importarPlano(tx, e.escritorioId, plano.id, { nome: "p.csv", conteudo: ok }, true);
      expect(b.criar).toBe(4);
      const caixa = await tx.contaContabil.findFirstOrThrow({ where: { planoId: plano.id, codigo: "1.01" } });
      expect(caixa).toMatchObject({ grupo: "ATIVO", natureza: "DEVEDORA", disponivel: true, analitica: true });
      const de_novo = await importarPlano(tx, e.escritorioId, plano.id, { nome: "p.csv", conteudo: ok }, false);
      expect(de_novo.linhas.every((l) => l.acao === "ignorar")).toBe(true);
      await criarConta(tx, e.escritorioId, plano.id, { codigo: "2.3.02", nome: "Reservas", analitica: true });
      await expect(criarConta(tx, e.escritorioId, plano.id, { codigo: "1.01.1", nome: "Sub do caixa", analitica: true })).rejects.toThrow(/analítica/);
    });
  });
});
