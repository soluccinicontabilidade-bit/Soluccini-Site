// Dados de demonstração. Uso: npm run db:seed
// Idempotente: se o escritório de demonstração já existe, não faz nada.
// Os CPFs e CNPJs são fictícios, gerados só para passar na validação.
import { randomUUID } from "node:crypto";
import { comAutenticacao, comEscritorio, prisma } from "../src/lib/db";
import { cifrar, indiceCego } from "../src/lib/cripto";
import { gerarHashSenha, gerarSenhaTemporaria } from "../src/lib/auth/senha";
import { adicionarVinculo, criarCliente, criarContrato, marcarItemChecklist } from "../src/lib/clientes";
import { CATEGORIAS_PADRAO } from "../src/lib/documentos";

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
    console.log("O escritório de demonstração já existe. Nada a fazer.");
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
