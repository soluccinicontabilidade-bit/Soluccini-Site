// Dados de demonstração. Uso: npm run db:seed
// Idempotente: se o escritório de demonstração já existe, não faz nada.
// Os CPFs e CNPJs são fictícios, gerados só para passar na validação.
import { randomUUID } from "node:crypto";
import { comAutenticacao, comEscritorio, prisma } from "../src/lib/db";
import { cifrar, indiceCego } from "../src/lib/cripto";
import { gerarHashSenha, gerarSenhaTemporaria } from "../src/lib/auth/senha";
import { adicionarVinculo, criarCliente, criarContrato, marcarItemChecklist } from "../src/lib/clientes";
import { CATEGORIAS_PADRAO } from "../src/lib/documentos";
import { copiarPlanoParaCliente, garantirModeloPadrao } from "../src/lib/contabil/plano";
import { aplicarSaldosIniciais, criarLancamento, lerCompetencia } from "../src/lib/contabil/lancamentos";
import { contasQuePedemJustificativa, mudarSituacaoPeriodo } from "../src/lib/contabil/periodos";
import { criarContaBancaria, criarTitulo, garantirCategoriasPadrao } from "../src/lib/financeiro/financeiro";
import { criarDeclaracao } from "../src/lib/irpf/irpf";
import { criarAcessoPortal } from "../src/lib/portal";
import { criarTarefa } from "../src/lib/tarefas";
import { pedirAprovacao } from "../src/lib/financeiro/financeiro";

function dv(base: string, pesos: number[]) {
  const soma = pesos.reduce((s, p, i) => s + p * Number(base[i]), 0);
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}
export function cnpjFicticio(raiz8: string, filial = "0001") {
  const b = raiz8 + filial;
  const d1 = dv(b, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(b + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${b}${d1}${d2}`;
}
export function cpfFicticio(base9: string) {
  const calc = (s: string, n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(s[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(base9, 9);
  const d2 = calc(base9 + d1, 10);
  return `${base9}${d1}${d2}`;
}

async function main() {
  const cnpjEscritorio = cnpjFicticio("48123456");
  const hash = indiceCego(cnpjEscritorio);
  const escritorioId = randomUUID();
  const senhaAdmin = process.env.SEED_SENHA || gerarSenhaTemporaria();
  const senhaEquipe = process.env.SEED_SENHA || gerarSenhaTemporaria();

  const ctx = { escritorioId, origem: "seed" };
  // Com o isolamento ativo, só dá para procurar pelo e-mail do administrador de demonstração.
  const existe = await comAutenticacao({ email: "admin@soluccini.local" }, (tx) => tx.usuario.count({ where: { email: "admin@soluccini.local" } }));
  if (existe > 0) {
    await semearContabil();
    return;
  }

  await comEscritorio(ctx, async (tx) => {
    await tx.escritorio.create({
      data: { id: escritorioId, nome: "Soluccini (demonstração)", cnpjCifrado: cifrar(cnpjEscritorio), cnpjHash: hash, cnpjFinal: cnpjEscritorio.slice(-4) },
    });
    await tx.categoriaDocumento.createMany({ data: CATEGORIAS_PADRAO.map((c) => ({ ...c, escritorioId })) });
    const [admin, contadora, bpo, irpf] = await Promise.all([
      tx.usuario.create({ data: { escritorioId, nome: "Administração", email: "admin@soluccini.local", perfil: "ADMINISTRADOR", senhaHash: await gerarHashSenha(senhaAdmin) } }),
      tx.usuario.create({ data: { escritorioId, nome: "Carla Contadora", email: "contadora@soluccini.local", perfil: "CONTADOR", senhaHash: await gerarHashSenha(senhaEquipe) } }),
      tx.usuario.create({ data: { escritorioId, nome: "Bruno BPO", email: "bpo@soluccini.local", perfil: "ANALISTA_BPO", senhaHash: await gerarHashSenha(senhaEquipe) } }),
      tx.usuario.create({ data: { escritorioId, nome: "Irene IRPF", email: "irpf@soluccini.local", perfil: "ANALISTA_IRPF", senhaHash: await gerarHashSenha(senhaEquipe) } }),
    ]);
    const autor = { id: admin.id, escritorioId, perfil: admin.perfil };
    const cartBpo = await tx.carteira.create({ data: { escritorioId, nome: "BPO", responsavelId: bpo.id } });
    const cartIrpf = await tx.carteira.create({ data: { escritorioId, nome: "IRPF", responsavelId: irpf.id } });
    void contadora;

    const padaria = await criarCliente(tx, autor, {
      pessoa: {
        tipo: "PJ", documento: cnpjFicticio("31415926"), nome: "Padaria Pão Quente Ltda", nomeFantasia: "Pão Quente",
        regimeTributario: "SIMPLES_NACIONAL", cnaePrincipal: "1091102", email: "contato@paoquente.exemplo",
        telefone: "(11) 3333-1000", cep: "01310100", logradouro: "Av. Paulista", numero: "1000", bairro: "Bela Vista", municipio: "São Paulo", uf: "SP",
      },
      inicioServico: "2026-01-01",
      carteiraIds: [cartBpo.id],
    });
    const clinica = await criarCliente(tx, autor, {
      pessoa: {
        tipo: "PJ", documento: cnpjFicticio("27182818"), nome: "Clínica Bem Viver Ltda", nomeFantasia: "Bem Viver",
        regimeTributario: "LUCRO_PRESUMIDO", cnaePrincipal: "8630503", email: "adm@bemviver.exemplo",
        cep: "30130000", logradouro: "Av. Afonso Pena", numero: "500", bairro: "Centro", municipio: "Belo Horizonte", uf: "MG",
      },
      inicioServico: "2026-02-01",
      carteiraIds: [cartBpo.id],
    });
    const cpfSocia = cpfFicticio("123456789");
    const pf = await criarCliente(tx, autor, {
      pessoa: { tipo: "PF", documento: cpfSocia, nome: "Mariana Souza", dataNascimento: "1985-04-12", email: "mariana@exemplo.com" },
      inicioServico: "2026-03-01",
      carteiraIds: [cartIrpf.id],
    });
    if (!padaria.ok || !clinica.ok || !pf.ok) throw new Error("Falha ao criar clientes de demonstração");

    // A PF é sócia da padaria (60%) e um segundo sócio só aparece como vínculo.
    await adicionarVinculo(tx, autor, padaria.cliente.id, { documento: cpfSocia, nome: "", tipo: "SOCIO_ADMINISTRADOR", participacao: "60", inicio: "2020-05-10" });
    await adicionarVinculo(tx, autor, padaria.cliente.id, { documento: cpfFicticio("987654321"), nome: "José Pereira", tipo: "SOCIO", participacao: "40", inicio: "2020-05-10" });
    await adicionarVinculo(tx, autor, clinica.cliente.id, { documento: cpfFicticio("111444777"), nome: "Dra. Ana Lima", tipo: "SOCIO_ADMINISTRADOR", participacao: "100", inicio: "2018-03-01" });

    await criarContrato(tx, autor, padaria.cliente.id, { servicos: ["CONTABIL", "BPO_FINANCEIRO"], inicio: "2026-01-01", diaVencimento: 10, valor: "1.200,00" });
    await criarContrato(tx, autor, clinica.cliente.id, { servicos: ["CONTABIL"], inicio: "2026-02-01", diaVencimento: 5, valor: "1.850,00" });
    await criarContrato(tx, autor, pf.cliente.id, { servicos: ["IRPF"], inicio: "2026-03-01", diaVencimento: 15, valor: "450,00" });

    // A padaria já concluiu a entrada; a clínica está no meio.
    for (const item of await tx.itemChecklistEntrada.findMany({ where: { clienteId: padaria.cliente.id } })) {
      await marcarItemChecklist(tx, autor, padaria.cliente.id, item.id, true);
    }
    await tx.cliente.update({ where: { id: padaria.cliente.id }, data: { situacao: "ATIVO" } });
    for (const item of (await tx.itemChecklistEntrada.findMany({ where: { clienteId: clinica.cliente.id }, orderBy: { ordem: "asc" } })).slice(0, 3)) {
      await marcarItemChecklist(tx, autor, clinica.cliente.id, item.id, true);
    }
    const etiqueta = await tx.etiqueta.create({ data: { escritorioId, nome: "Prioridade", cor: "#8961C8" } });
    await tx.clienteEtiqueta.create({ data: { escritorioId, clienteId: clinica.cliente.id, etiquetaId: etiqueta.id } });
  }, { timeout: 60000 });

  console.log("Escritório de demonstração criado.");
  console.log(`  admin@soluccini.local      senha: ${senhaAdmin}`);
  console.log(`  contadora@soluccini.local  senha: ${senhaEquipe}`);
  console.log(`  bpo@soluccini.local        senha: ${senhaEquipe}`);
  console.log(`  irpf@soluccini.local       senha: ${senhaEquipe}`);
  console.log("No primeiro acesso, cada pessoa ativa a verificação em duas etapas.");
  await semearContabil();
}

// Fase 2: modelo de plano de contas, planos da padaria e da clínica, saldos
// iniciais e três meses de lançamentos da padaria, com janeiro fechado.
async function semearContabil() {
  const usuarios = await comAutenticacao({ email: "admin@soluccini.local" }, (tx) => tx.usuario.findMany({ where: { email: "admin@soluccini.local" } }));
  const admin = usuarios[0];
  const escritorioId = admin.escritorioId;
  const ctxAdmin = { escritorioId, usuarioId: admin.id, perfil: admin.perfil, origem: "seed" };
  const autor = { id: admin.id, escritorioId, perfil: admin.perfil };
  const feito = await comEscritorio(ctxAdmin, (tx) => tx.planoDeContas.count({ where: { clienteId: { not: null } } }));
  if (feito > 0) {
    await semearFinanceiro();
    return;
  }
  const contador = await comEscritorio(ctxAdmin, (tx) => tx.usuario.findFirstOrThrow({ where: { perfil: "CONTADOR" } }));
  const padariaId = await comEscritorio(ctxAdmin, async (tx) => {
    const modelo = await garantirModeloPadrao(tx, escritorioId);
    const [padaria, clinica] = await Promise.all([
      tx.cliente.findFirstOrThrow({ where: { pessoa: { nome: { startsWith: "Padaria" } } } }),
      tx.cliente.findFirstOrThrow({ where: { pessoa: { nome: { startsWith: "Clínica" } } } }),
    ]);
    await copiarPlanoParaCliente(tx, autor, padaria.id, modelo.id);
    await copiarPlanoParaCliente(tx, autor, clinica.id, modelo.id);
    const saldos = [
      "conta;debito;credito",
      "1.1.1.01;1.200,00;", "1.1.1.02;18.500,00;", "1.1.4.01;6.300,00;", "1.2.3.02;24.000,00;", "1.2.3.90;;4.800,00",
      "2.1.1.01;;7.200,00", "2.1.4.01;;1.850,00", "2.3.1.01;;30.000,00", "2.3.3.01;;6.150,00",
    ].join("\n");
    await aplicarSaldosIniciais(tx, autor, padaria.id, "2026-01-01", { nome: "saldos-padaria-2026.csv", conteudo: Buffer.from(saldos) });
    const L = (data: string, historico: string, partidas: [string, "D" | "C", string][]) =>
      criarLancamento(tx, autor, padaria.id, { data, historico, partidas: partidas.map(([conta, t, valor]) => ({ conta, tipo: t === "D" ? "DEBITO" : "CREDITO", valor })) });
    for (const [mes, vendas, cmv, aluguel] of [["01", "42.300,00", "18.900,00", "4.500,00"], ["02", "39.850,00", "17.600,00", "4.500,00"], ["03", "45.120,00", "20.100,00", "4.500,00"]] as const) {
      await L(`2026-${mes}-05`, `Pagamento do aluguel de ${mes}/2026`, [["5.1.2.01", "D", aluguel], ["1.1.1.02", "C", aluguel]]);
      await L(`2026-${mes}-10`, `Compras de mercadorias de ${mes}/2026`, [["1.1.4.01", "D", cmv], ["2.1.1.01", "C", cmv]]);
      await L(`2026-${mes}-20`, `Pagamento a fornecedores`, [["2.1.1.01", "D", "15.000,00"], ["1.1.1.02", "C", "15.000,00"]]);
      await L(`2026-${mes}-28`, `Vendas do mês ${mes}/2026 (cartão e dinheiro)`, [["1.1.1.02", "D", vendas], ["3.1.1.01", "C", vendas]]);
      await L(`2026-${mes}-28`, `Custo das mercadorias vendidas em ${mes}/2026`, [["4.1.1.01", "D", cmv], ["1.1.4.01", "C", cmv]]);
      await L(`2026-${mes}-28`, `Simples Nacional sobre vendas de ${mes}/2026 (valor ilustrativo)`, [["3.2.1.02", "D", "2.400,00"], ["2.1.4.01", "C", "2.400,00"]]);
      await L(`2026-${mes}-28`, `Tarifas bancárias`, [["5.2.1.01", "D", "89,90"], ["1.1.1.02", "C", "89,90"]]);
    }
    return padaria.id;
  }, { timeout: 120000 });

  // Janeiro: conferido e fechado pela contadora. Fevereiro: em conferência.
  const ctxContador = { escritorioId, usuarioId: contador.id, perfil: contador.perfil, origem: "seed" };
  const autorContador = { id: contador.id, escritorioId, perfil: contador.perfil };
  await comEscritorio(ctxContador, async (tx) => {
    const jan = lerCompetencia("2026-01");
    await mudarSituacaoPeriodo(tx, autorContador, padariaId, { competencia: jan, para: "EM_CONFERENCIA" });
    const pend = await contasQuePedemJustificativa(tx, padariaId, jan);
    await mudarSituacaoPeriodo(tx, autorContador, padariaId, {
      competencia: jan, para: "FECHADO",
      justificativasContas: Object.fromEntries(pend.map((p) => [p.conta.id, "Saldo conferido com o extrato de janeiro"])),
    });
    await mudarSituacaoPeriodo(tx, autorContador, padariaId, { competencia: lerCompetencia("2026-02"), para: "EM_CONFERENCIA" });
  }, { timeout: 60000 });
  console.log("Contabilidade de demonstração criada: padaria com saldos iniciais e lançamentos de jan a mar/2026 (janeiro fechado).");
  await semearFinanceiro();
}

// Fase 3: BPO da padaria a partir de abril/2026 (conta Itaú, categorias e títulos).
// O extrato de exemplo está em exemplos/extrato-padaria-2026-04.ofx.
async function semearFinanceiro() {
  const [admin] = await comAutenticacao({ email: "admin@soluccini.local" }, (tx) => tx.usuario.findMany({ where: { email: "admin@soluccini.local" } }));
  const ctx = { escritorioId: admin.escritorioId, usuarioId: admin.id, perfil: admin.perfil, origem: "seed" };
  const autor = { id: admin.id, escritorioId: admin.escritorioId, perfil: admin.perfil };
  const feito = await comEscritorio(ctx, (tx) => tx.contaBancaria.count());
  if (feito > 0) {
    await semearIrpf();
    return;
  }
  await comEscritorio(ctx, async (tx) => {
    const padaria = await tx.cliente.findFirstOrThrow({ where: { pessoa: { nome: { startsWith: "Padaria" } } } });
    await garantirCategoriasPadrao(tx, autor, padaria.id);
    const banco = await tx.contaContabil.findFirstOrThrow({ where: { plano: { clienteId: padaria.id }, codigo: "1.1.1.02" } });
    // Saldo de abertura do BPO = saldo do banco na contabilidade em 31/03/2026.
    const conta = await criarContaBancaria(tx, autor, padaria.id, { nome: "Itaú movimento", tipo: "CORRENTE", bancoCodigo: "341", agencia: "1234", numero: "56789-0", saldoInicial: "18.500,00", dataSaldoInicial: "2026-04-01", contaContabilId: banco.id });
    const cat = async (nome: string) => (await tx.categoriaFinanceira.findFirstOrThrow({ where: { clienteId: padaria.id, nome } })).id;
    const T = (e: Parameters<typeof criarTitulo>[3]) => criarTitulo(tx, autor, padaria.id, { contaPrevistaId: conta.id, ...e });
    await T({ tipo: "PAGAR", descricao: "Aluguel da loja", favorecido: "Imobiliária Centro", competencia: "2026-04", valor: "4.500,00", primeiroVencimento: "2026-04-05", categoriaId: await cat("Aluguel"), repetirMeses: 2 });
    await T({ tipo: "PAGAR", descricao: "Conta de energia", favorecido: "Enel", competencia: "2026-04", valor: "612,40", primeiroVencimento: "2026-04-10", categoriaId: await cat("Energia elétrica") });
    await T({ tipo: "PAGAR", descricao: "Farinha e insumos", favorecido: "Moinho Trigo Bom Ltda", competencia: "2026-04", valor: "15.000,00", primeiroVencimento: "2026-04-20", categoriaId: await cat("Compra de mercadorias") });
    await T({ tipo: "RECEBER", descricao: "Vendas no cartão (1ª quinzena)", favorecido: "Cielo", competencia: "2026-04", valor: "21.350,00", primeiroVencimento: "2026-04-15", categoriaId: await cat("Vendas de mercadorias") });
    await T({ tipo: "PAGAR", descricao: "Pró-labore Mariana", favorecido: "Mariana Souza", documentoFavorecido: "12345678909", competencia: "2026-04", valor: "3.000,00", primeiroVencimento: "2026-05-05", categoriaId: await cat("Pró-labore") });
  }, { timeout: 60000 });
  console.log("Financeiro de demonstração criado: conta Itaú da padaria e títulos de abril/2026. Importe exemplos/extrato-padaria-2026-04.ofx para testar a conciliação.");
  await semearIrpf();
}

// Fase 5: declaração 2026 da Mariana (cliente PF e sócia da padaria).
async function semearIrpf() {
  const [admin] = await comAutenticacao({ email: "admin@soluccini.local" }, (tx) => tx.usuario.findMany({ where: { email: "admin@soluccini.local" } }));
  const ctx = { escritorioId: admin.escritorioId, usuarioId: admin.id, perfil: admin.perfil, origem: "seed" };
  const autor = { id: admin.id, escritorioId: admin.escritorioId, perfil: admin.perfil };
  await comEscritorio(ctx, async (tx) => {
    if (await tx.declaracaoIRPF.count({ where: { anoCalendario: 2026 } })) return;
    const mariana = await tx.cliente.findFirstOrThrow({ where: { pessoa: { nome: "Mariana Souza" } } });
    const irene = await tx.usuario.findFirst({ where: { perfil: "ANALISTA_IRPF" } });
    await criarDeclaracao(tx, autor, { pessoaId: mariana.pessoaId, clienteId: mariana.id, ano: 2026, responsavelId: irene?.id, honorario: "450,00" });
    console.log("IRPF de demonstração criado: declaração 2026 da Mariana Souza.");
  });
  await semearPortal();
}

// Fases 6 e 7: Mariana aprova pagamentos da padaria no portal; tarefas e Pix de exemplo.
async function semearPortal() {
  const [admin] = await comAutenticacao({ email: "admin@soluccini.local" }, (tx) => tx.usuario.findMany({ where: { email: "admin@soluccini.local" } }));
  const ctx = { escritorioId: admin.escritorioId, usuarioId: admin.id, perfil: admin.perfil, origem: "seed" };
  const autor = { id: admin.id, escritorioId: admin.escritorioId, perfil: admin.perfil };
  await comEscritorio(ctx, async (tx) => {
    if (await tx.acessoCliente.count()) {
      console.log("Dados de demonstração já existem. Nada a fazer.");
      return;
    }
    const padaria = await tx.cliente.findFirstOrThrow({ where: { pessoa: { nome: { startsWith: "Padaria" } } } });
    const r = await criarAcessoPortal(tx, autor, padaria.id, { nome: "Mariana Souza", email: "mariana@portal.local", perfil: "CLIENTE_APROVADOR" });
    if (process.env.SEED_SENHA && r.senhaTemporaria) {
      const { gerarHashSenha } = await import("../src/lib/auth/senha");
      await tx.usuario.update({ where: { email: "mariana@portal.local" } as never, data: { senhaHash: await gerarHashSenha(process.env.SEED_SENHA) } }).catch(() => undefined);
    }
    const prolabore = await tx.parcela.findFirst({ where: { clienteId: padaria.id, titulo: { descricao: "Pró-labore Mariana" } } });
    if (prolabore) await pedirAprovacao(tx, autor, padaria.id, [prolabore.id]);
    const contadora = await tx.usuario.findFirst({ where: { perfil: "CONTADOR" } });
    await criarTarefa(tx, autor, { titulo: "Fechar o mês contábil da padaria", clienteId: padaria.id, responsavelId: contadora?.id, prazo: "2026-05-10", recorrencia: "MENSAL" });
    await tx.configEscritorio.upsert({ where: { escritorioId: admin.escritorioId }, create: { escritorioId: admin.escritorioId, chavePix: "contato@soluccini.local", nomeRecebedor: "SOLUCCINI DEMONSTRACAO", cidadeRecebedor: "SAO PAULO" }, update: {} });
    console.log(`Portal de demonstração: mariana@portal.local (aprovadora da padaria)${r.senhaTemporaria ? ` senha: ${process.env.SEED_SENHA || r.senhaTemporaria}` : ""}`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
