import { describe, expect, it } from "vitest";
import { comEscritorio, prisma, type Tx } from "@/lib/db";
import { criarCliente, criarContrato, listarClientes } from "@/lib/clientes";
import { enviarDocumento } from "@/lib/documentos";
import { concluirTarefa, criarTarefa } from "@/lib/tarefas";
import { criarAcessoPortal, criarAgendamento, dadosDoTitular, removerAcessoPortal } from "@/lib/portal";
import { gerarCobrancasDoMes, registrarPagamento, salvarConfigPix } from "@/lib/cobranca/cobrancas";
import { aceitar, solicitarAceite } from "@/lib/cobranca/aceite";
import { crc16 } from "@/lib/cobranca/pix";
import { gerarAvisos, rodarAgendamentos } from "@/lib/rotinas";
import { garantirModeloPadrao, copiarPlanoParaCliente } from "@/lib/contabil/plano";
import { criarLancamento, lerCompetencia } from "@/lib/contabil/lancamentos";
import { entrarComSenha, MAX_TENTATIVAS_IP } from "@/lib/auth/login";
import { dataCivil } from "@/lib/br";
import { cnpjFicticio, novoEscritorio, temBanco } from "./ajuda";

async function cenario() {
  const e = await novoEscritorio();
  const A = <T,>(fn: (tx: Tx) => Promise<T>) => comEscritorio(e.ctx(e.admin), fn, { timeout: 60000 });
  const a = e.autor(e.admin);
  const [c1, c2] = await A(async (tx) => {
    const x = await criarCliente(tx, a, { pessoa: { tipo: "PJ", documento: cnpjFicticio(), nome: "Cliente Portal", email: "c@exemplo.com" }, inicioServico: "2026-01-01" });
    const y = await criarCliente(tx, a, { pessoa: { tipo: "PJ", documento: cnpjFicticio(), nome: "Outro Cliente" }, inicioServico: "2026-01-01" });
    if (!x.ok || !y.ok) throw new Error();
    return [x.cliente.id, y.cliente.id];
  });
  return { ...e, A, a, c1, c2 };
}

describe.skipIf(!temBanco)("portal, tarefas, rotinas e cobrança (banco real)", () => {
  it("usuário do portal só enxerga a própria empresa e perde acesso ao ser removido", async () => {
    const e = await cenario();
    const r = await e.A((tx) => criarAcessoPortal(tx, e.a, e.c1, { nome: "Dona", email: `dona-${Date.now()}@exemplo.com`, perfil: "CLIENTE_APROVADOR" }));
    expect(r.senhaTemporaria).toBeTruthy();
    const u = await e.A((tx) => tx.usuario.findFirstOrThrow({ where: { nome: "Dona" } }));
    const visiveis = await comEscritorio({ escritorioId: e.escritorioId, usuarioId: u.id, perfil: u.perfil }, (tx) => listarClientes(tx, { id: u.id, escritorioId: e.escritorioId, perfil: u.perfil }));
    expect(visiveis.map((c) => c.pessoa.nome)).toEqual(["Cliente Portal"]);
    await expect(e.A((tx) => criarAcessoPortal(tx, e.a, e.c1, { nome: "X", email: e.bpo.email, perfil: "CLIENTE_LEITOR" }))).rejects.toThrow(/equipe/);
    await e.A((tx) => removerAcessoPortal(tx, e.a, e.c1, u.id));
    expect((await e.A((tx) => tx.usuario.findUniqueOrThrow({ where: { id: u.id } }))).ativo).toBe(false);
  });

  it("tarefa recorrente gera a próxima ao concluir, uma única vez", async () => {
    const e = await cenario();
    const t = await e.A((tx) => criarTarefa(tx, e.a, { titulo: "Enviar relatório mensal", clienteId: e.c1, prazo: "2026-01-31", recorrencia: "MENSAL" }));
    await e.A((tx) => concluirTarefa(tx, e.a, t.id));
    await e.A((tx) => concluirTarefa(tx, e.a, t.id));
    const todas = await e.A((tx) => tx.tarefa.findMany({ where: { titulo: "Enviar relatório mensal" }, orderBy: { prazo: "asc" } }));
    expect(todas.map((x) => x.prazo.toISOString().slice(0, 10))).toEqual(["2026-01-31", "2026-02-28"]);
  });

  it("cobranças do mês: geradas pelos contratos com Pix válido, sem duplicar; baixa manual", async () => {
    const e = await cenario();
    await e.A((tx) => salvarConfigPix(tx, e.a, { chavePix: "11222333000181", nomeRecebedor: "Escritório Teste", cidadeRecebedor: "São Paulo" }));
    await e.A((tx) => criarContrato(tx, e.a, e.c1, { servicos: ["CONTABIL"], inicio: "2026-01-01", diaVencimento: 10, valor: "1.500,00" }));
    const mar = lerCompetencia("2026-03");
    expect((await e.A((tx) => gerarCobrancasDoMes(tx, e.a, mar))).criadas).toBe(1);
    expect((await e.A((tx) => gerarCobrancasDoMes(tx, e.a, mar))).criadas).toBe(0);
    const c = await e.A((tx) => tx.cobranca.findFirstOrThrow({ where: { clienteId: e.c1 } }));
    expect(c.vencimento.toISOString().slice(0, 10)).toBe("2026-03-10");
    expect(c.pixCopiaECola).toContain("54071500.00");
    expect(crc16(c.pixCopiaECola!.slice(0, -4))).toBe(c.pixCopiaECola!.slice(-4));
    await e.A((tx) => registrarPagamento(tx, e.a, c.id, { data: "2026-03-09", valor: "" }));
    expect((await e.A((tx) => tx.cobranca.findUniqueOrThrow({ where: { id: c.id } }))).valorPagoCentavos).toBe(150000n);
  });

  it("aceite: registra hash e usuário, uma vez, e não pode ser alterado", async () => {
    const e = await cenario();
    await e.A((tx) => criarAcessoPortal(tx, e.a, e.c1, { nome: "Leitora", email: `leitora-${Date.now()}@exemplo.com`, perfil: "CLIENTE_LEITOR" }));
    const u = await e.A((tx) => tx.usuario.findFirstOrThrow({ where: { nome: "Leitora" } }));
    const s = await e.A(async (tx) => {
      const cat = await tx.categoriaDocumento.findFirstOrThrow({ where: { nome: "Outros" } });
      const doc = await enviarDocumento(tx, e.a, e.c1, { categoriaId: cat.id, titulo: "Contrato 2026", arquivo: { nome: "contrato.pdf", tipo: "application/pdf", conteudo: Buffer.from(`%PDF-1.7 contrato ${Math.random()}`) } });
      return solicitarAceite(tx, e.a, e.c1, doc.id, "Leia e aceite");
    });
    const U = { id: u.id, escritorioId: e.escritorioId, perfil: u.perfil, nome: u.nome, email: u.email };
    await comEscritorio({ escritorioId: e.escritorioId, usuarioId: u.id, perfil: u.perfil }, (tx) => aceitar(tx, U, s.id, "200.1.2.3", "teste"));
    await expect(comEscritorio({ escritorioId: e.escritorioId, usuarioId: u.id, perfil: u.perfil }, (tx) => aceitar(tx, U, s.id, null, null))).rejects.toThrow(/já aceitou/);
    const ac = await e.A((tx) => tx.aceiteDocumento.findFirstOrThrow({ where: { solicitacaoId: s.id } }));
    expect(ac.sha256Documento).toMatch(/^[0-9a-f]{64}$/);
    await expect(prisma.$executeRawUnsafe(`update aceite_documento set nome_usuario = 'x' where id = '${ac.id}'`)).rejects.toThrow();
  });

  it("relatório agendado sem e-mail configurado fica guardado como documento; avisos do dia", async () => {
    const e = await cenario();
    await e.A(async (tx) => {
      const m = await garantirModeloPadrao(tx, e.escritorioId);
      await copiarPlanoParaCliente(tx, e.a, e.c1, m.id);
      await criarLancamento(tx, e.a, e.c1, { data: "2026-02-10", historico: "Venda", partidas: [{ conta: "1.1.1.02", tipo: "DEBITO", valor: "100,00" }, { conta: "3.1.1.01", tipo: "CREDITO", valor: "100,00" }] });
      await criarAgendamento(tx, e.a, e.c1, { modulo: "CONTABIL", tipo: "dre", dia: 5, destinatarios: "c@exemplo.com" });
      await criarTarefa(tx, e.a, { titulo: "Prazo chegando", prazo: "2026-03-06", responsavelId: e.bpo.id });
    });
    const r = await rodarAgendamentos(e.escritorioId, dataCivil("2026-03-05"));
    expect(r).toEqual(["Cliente Portal: GUARDADO_SEM_EMAIL"]);
    expect(await rodarAgendamentos(e.escritorioId, dataCivil("2026-03-06"))).toEqual([]); // não repete no mês
    const doc = await e.A((tx) => tx.documento.findFirstOrThrow({ where: { clienteId: e.c1, categoria: { nome: "Relatórios enviados" } } }));
    expect(doc.titulo).toMatch(/DRE 2026-02/);
    expect(await gerarAvisos(e.escritorioId, dataCivil("2026-03-05"))).toBeGreaterThan(0);
    expect(await e.A((tx) => tx.notificacao.count({ where: { usuarioId: e.bpo.id } }))).toBe(1);
  });

  it("LGPD: exporta os dados do titular com o documento em claro, sem segredos", async () => {
    const e = await cenario();
    const p = await e.A((tx) => tx.cliente.findUniqueOrThrow({ where: { id: e.c1 } }));
    const j = await e.A((tx) => dadosDoTitular(tx, e.a, p.pessoaId));
    expect(JSON.stringify(j)).toContain("Cliente Portal");
    expect(JSON.stringify(j)).not.toMatch(/documentoCifrado|senhaHash/);
    await expect(comEscritorio(e.ctx(e.contador), (tx) => dadosDoTitular(tx, e.autor(e.contador), p.pessoaId))).rejects.toThrow(/administrador/);
  });

  it(`login: bloqueia o IP depois de ${MAX_TENTATIVAS_IP} falhas em 15 minutos`, async () => {
    const ip = `10.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
    for (let i = 0; i < MAX_TENTATIVAS_IP; i++) await prisma.tentativaAcesso.create({ data: { ip } });
    const r = await entrarComSenha("qualquer@teste.local", "senha qualquer", ip);
    expect(r).toMatchObject({ ok: false, mensagem: expect.stringMatching(/Muitas tentativas/) });
  });
});
