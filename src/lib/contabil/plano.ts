import type { GrupoConta, NaturezaConta, PerfilUsuario, Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { ErroDeNegocio } from "@/lib/erros";
import { lerTabela, normalizarCabecalho } from "@/lib/planilha";
import { obterClienteVisivel, registrarEvento } from "@/lib/clientes";

interface Autor {
  id: string;
  escritorioId: string;
  perfil: PerfilUsuario;
}

export const NOME_GRUPO: Record<GrupoConta, string> = {
  ATIVO: "Ativo",
  PASSIVO: "Passivo",
  PATRIMONIO_LIQUIDO: "Patrimônio líquido",
  RECEITA: "Receitas",
  CUSTO: "Custos",
  DESPESA: "Despesas",
  APURACAO: "Apuração do resultado",
};

export const NATUREZA_PADRAO: Record<GrupoConta, NaturezaConta> = {
  ATIVO: "DEVEDORA",
  PASSIVO: "CREDORA",
  PATRIMONIO_LIQUIDO: "CREDORA",
  RECEITA: "CREDORA",
  CUSTO: "DEVEDORA",
  DESPESA: "DEVEDORA",
  APURACAO: "CREDORA",
};

export const GRUPOS_RESULTADO: GrupoConta[] = ["RECEITA", "CUSTO", "DESPESA", "APURACAO"];

// ---------------------------------------------------------------------------
// Modelo padrão
// ---------------------------------------------------------------------------
// Estrutura simplificada para pequenas empresas. Ponto de partida: o
// contador revisa e ajusta antes de usar. Os códigos do plano referencial da
// Receita Federal NÃO são preenchidos aqui (não inventamos), ficam para o
// contador informar conta a conta.
// Formato: [código, nome, opções]. "A" = analítica; "D"/"C" força a natureza
// (contas redutoras); "$" = caixa e equivalentes.

type LinhaModelo = [string, string, string?];

const MODELO: { grupo: GrupoConta; linhas: LinhaModelo[] }[] = [
  {
    grupo: "ATIVO",
    linhas: [
      ["1", "Ativo"], ["1.1", "Ativo circulante"],
      ["1.1.1", "Disponível"],
      ["1.1.1.01", "Caixa", "A$"], ["1.1.1.02", "Bancos conta movimento", "A$"], ["1.1.1.03", "Aplicações financeiras de liquidez imediata", "A$"],
      ["1.1.2", "Créditos"],
      ["1.1.2.01", "Clientes", "A"], ["1.1.2.02", "(-) Perdas estimadas com clientes", "AC"], ["1.1.2.03", "Adiantamentos a fornecedores", "A"], ["1.1.2.04", "Adiantamentos a empregados", "A"],
      ["1.1.3", "Tributos a recuperar"], ["1.1.3.01", "Impostos e contribuições a recuperar", "A"],
      ["1.1.4", "Estoques"], ["1.1.4.01", "Mercadorias para revenda", "A"], ["1.1.4.02", "Matérias-primas e insumos", "A"],
      ["1.1.5", "Despesas antecipadas"], ["1.1.5.01", "Despesas pagas antecipadamente", "A"],
      ["1.2", "Ativo não circulante"],
      ["1.2.1", "Realizável a longo prazo"], ["1.2.1.01", "Empréstimos a sócios", "A"],
      ["1.2.2", "Investimentos"], ["1.2.2.01", "Participações em outras empresas", "A"],
      ["1.2.3", "Imobilizado"],
      ["1.2.3.01", "Móveis e utensílios", "A"], ["1.2.3.02", "Máquinas e equipamentos", "A"], ["1.2.3.03", "Computadores e periféricos", "A"],
      ["1.2.3.04", "Veículos", "A"], ["1.2.3.05", "Imóveis", "A"], ["1.2.3.90", "(-) Depreciação acumulada", "AC"],
      ["1.2.4", "Intangível"], ["1.2.4.01", "Softwares, marcas e direitos", "A"], ["1.2.4.90", "(-) Amortização acumulada", "AC"],
    ],
  },
  {
    grupo: "PASSIVO",
    linhas: [
      ["2", "Passivo"], ["2.1", "Passivo circulante"],
      ["2.1.1", "Fornecedores"], ["2.1.1.01", "Fornecedores", "A"],
      ["2.1.2", "Obrigações trabalhistas"], ["2.1.2.01", "Salários a pagar", "A"], ["2.1.2.02", "Pró-labore a pagar", "A"], ["2.1.2.03", "Férias e 13º salário a pagar", "A"],
      ["2.1.3", "Obrigações sociais"], ["2.1.3.01", "INSS a recolher", "A"], ["2.1.3.02", "FGTS a recolher", "A"],
      ["2.1.4", "Obrigações tributárias"], ["2.1.4.01", "Simples Nacional a recolher", "A"], ["2.1.4.02", "Impostos e contribuições a recolher", "A"], ["2.1.4.03", "Tributos retidos a recolher", "A"],
      ["2.1.5", "Empréstimos e financiamentos"], ["2.1.5.01", "Empréstimos e financiamentos", "A"],
      ["2.1.6", "Outras obrigações"], ["2.1.6.01", "Lucros a distribuir", "A"], ["2.1.6.02", "Adiantamentos de clientes", "A"], ["2.1.6.03", "Contas a pagar", "A"],
      ["2.2", "Passivo não circulante"],
      ["2.2.1", "Empréstimos e financiamentos de longo prazo"], ["2.2.1.01", "Empréstimos e financiamentos de longo prazo", "A"],
      ["2.2.2", "Débitos com sócios"], ["2.2.2.01", "Empréstimos de sócios", "A"],
    ],
  },
  {
    grupo: "PATRIMONIO_LIQUIDO",
    linhas: [
      ["2.3", "Patrimônio líquido"],
      ["2.3.1", "Capital social"], ["2.3.1.01", "Capital subscrito", "A"], ["2.3.1.02", "(-) Capital a integralizar", "AD"],
      ["2.3.2", "Reservas"], ["2.3.2.01", "Reservas de lucros", "A"],
      ["2.3.3", "Lucros ou prejuízos acumulados"], ["2.3.3.01", "Lucros acumulados", "A"], ["2.3.3.02", "(-) Prejuízos acumulados", "AD"],
    ],
  },
  {
    grupo: "RECEITA",
    linhas: [
      ["3", "Receitas"], ["3.1", "Receita bruta"],
      ["3.1.1", "Vendas e serviços"], ["3.1.1.01", "Venda de mercadorias", "A"], ["3.1.1.02", "Venda de produtos", "A"], ["3.1.1.03", "Prestação de serviços", "A"],
      ["3.2", "(-) Deduções da receita bruta"],
      ["3.2.1", "Deduções"], ["3.2.1.01", "(-) Devoluções e cancelamentos", "AD"], ["3.2.1.02", "(-) Tributos sobre vendas e serviços", "AD"],
      ["3.3", "Outras receitas"],
      ["3.3.1", "Receitas financeiras"], ["3.3.1.01", "Rendimentos de aplicações financeiras", "A"], ["3.3.1.02", "Juros e descontos obtidos", "A"],
      ["3.3.2", "Outras receitas operacionais"], ["3.3.2.01", "Outras receitas", "A"],
    ],
  },
  {
    grupo: "CUSTO",
    linhas: [
      ["4", "Custos"], ["4.1", "Custos das vendas e serviços"],
      ["4.1.1", "Custos"], ["4.1.1.01", "Custo das mercadorias vendidas", "A"], ["4.1.1.02", "Custo dos produtos vendidos", "A"], ["4.1.1.03", "Custo dos serviços prestados", "A"],
    ],
  },
  {
    grupo: "DESPESA",
    linhas: [
      ["5", "Despesas"], ["5.1", "Despesas operacionais"],
      ["5.1.1", "Despesas com pessoal"], ["5.1.1.01", "Salários", "A"], ["5.1.1.02", "Pró-labore", "A"], ["5.1.1.03", "Encargos sociais", "A"], ["5.1.1.04", "Benefícios", "A"],
      ["5.1.2", "Despesas administrativas"], ["5.1.2.01", "Aluguel", "A"], ["5.1.2.02", "Energia elétrica", "A"], ["5.1.2.03", "Água e esgoto", "A"],
      ["5.1.2.04", "Telefone e internet", "A"], ["5.1.2.05", "Honorários contábeis", "A"], ["5.1.2.06", "Material de escritório", "A"],
      ["5.1.2.07", "Sistemas e softwares", "A"], ["5.1.2.08", "Depreciação e amortização", "A"], ["5.1.2.09", "Manutenção e conservação", "A"],
      ["5.1.3", "Despesas comerciais"], ["5.1.3.01", "Propaganda e publicidade", "A"], ["5.1.3.02", "Comissões sobre vendas", "A"], ["5.1.3.03", "Fretes", "A"],
      ["5.1.4", "Despesas tributárias"], ["5.1.4.01", "Taxas e impostos diversos", "A"],
      ["5.2", "Despesas financeiras"],
      ["5.2.1", "Despesas financeiras"], ["5.2.1.01", "Tarifas bancárias", "A"], ["5.2.1.02", "Juros pagos", "A"], ["5.2.1.03", "Descontos concedidos", "A"],
      ["5.3", "Tributos sobre o lucro"],
      ["5.3.1", "IRPJ e CSLL"], ["5.3.1.01", "IRPJ", "A"], ["5.3.1.02", "CSLL", "A"],
    ],
  },
];

export const nivelDoCodigo = (codigo: string) => codigo.split(".").length;

/**
 * Pai = conta de código mais longo que é prefixo (por segmento) do código
 * dado. Com `grupo`, só vale prefixo do mesmo grupo: assim o patrimônio
 * líquido pode ficar em 2.3 sem ser filho do passivo (2).
 */
export function codigoDoPai(codigo: string, existentes: Iterable<string> | Map<string, GrupoConta>, grupo?: GrupoConta): string | null {
  const partes = codigo.split(".");
  const mapa = existentes instanceof Map ? existentes : null;
  const conjunto = mapa ? new Set(mapa.keys()) : new Set(existentes as Iterable<string>);
  for (let n = partes.length - 1; n >= 1; n--) {
    const candidato = partes.slice(0, n).join(".");
    if (conjunto.has(candidato) && (!grupo || !mapa || mapa.get(candidato) === grupo)) return candidato;
  }
  return null;
}

export function validarCodigo(codigo: string): string | null {
  if (!/^\d+(\.\d+)*$/.test(codigo)) return "Use só números separados por ponto, por exemplo 1.1.1.01.";
  if (codigo.length > 40) return "Código longo demais.";
  return null;
}

interface ContaNova {
  codigo: string;
  nome: string;
  grupo: GrupoConta;
  natureza: NaturezaConta;
  analitica: boolean;
  disponivel?: boolean;
  codigoReferencial?: string | null;
}

/** Cria as contas em ordem de código, ligando cada uma ao pai. */
async function criarContas(tx: Tx, escritorioId: string, planoId: string, contas: ContaNova[]) {
  const ids = new Map<string, string>();
  const grupos = new Map<string, GrupoConta>();
  const existentes = await tx.contaContabil.findMany({ where: { planoId }, select: { id: true, codigo: true, grupo: true } });
  for (const c of existentes) {
    ids.set(c.codigo, c.id);
    grupos.set(c.codigo, c.grupo);
  }
  const ordenadas = [...contas].sort((a, b) => compararCodigos(a.codigo, b.codigo));
  for (const c of ordenadas) {
    const pai = codigoDoPai(c.codigo, grupos, c.grupo);
    const criada = await tx.contaContabil.create({
      data: {
        escritorioId, planoId, codigo: c.codigo, nome: c.nome, grupo: c.grupo, natureza: c.natureza,
        analitica: c.analitica, disponivel: c.disponivel ?? false, nivel: nivelDoCodigo(c.codigo),
        paiId: pai ? ids.get(pai)! : null, codigoReferencial: c.codigoReferencial ?? null,
      },
    });
    ids.set(c.codigo, criada.id);
    grupos.set(c.codigo, c.grupo);
  }
}

export function compararCodigos(a: string, b: string) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

export function contasDoModelo(): ContaNova[] {
  return MODELO.flatMap(({ grupo, linhas }) =>
    linhas.map(([codigo, nome, op = ""]) => ({
      codigo, nome, grupo,
      analitica: op.includes("A"),
      disponivel: op.includes("$"),
      natureza: op.includes("D") ? "DEVEDORA" : op.includes("C") ? "CREDORA" : NATUREZA_PADRAO[grupo],
    })),
  );
}

/** Cria o modelo padrão do escritório (se ainda não houver nenhum modelo). */
export async function garantirModeloPadrao(tx: Tx, escritorioId: string) {
  const existente = await tx.planoDeContas.findFirst({ where: { clienteId: null } });
  if (existente) return existente;
  const plano = await tx.planoDeContas.create({ data: { escritorioId, nome: "Modelo padrão (revisar antes de usar)" } });
  await criarContas(tx, escritorioId, plano.id, contasDoModelo());
  return plano;
}

/** Copia um plano (normalmente um modelo) para o cliente. */
export async function copiarPlanoParaCliente(tx: Tx, autor: Autor, clienteId: string, origemId: string) {
  const cliente = await obterClienteVisivel(tx, autor, clienteId);
  if (!cliente) throw new ErroDeNegocio("Cliente não encontrado.");
  if (await tx.planoDeContas.findUnique({ where: { clienteId } })) throw new ErroDeNegocio("Este cliente já tem plano de contas.");
  const origem = await tx.planoDeContas.findUnique({ where: { id: origemId }, include: { contas: true } });
  if (!origem) throw new ErroDeNegocio("Escolha o modelo.");
  const plano = await tx.planoDeContas.create({
    data: { escritorioId: autor.escritorioId, clienteId, nome: `Plano de ${cliente.pessoa.nome}`, copiadoDeId: origem.id },
  });
  await criarContas(tx, autor.escritorioId, plano.id, origem.contas.filter((c) => c.ativa));
  await registrarEvento(tx, autor, clienteId, "plano.criado", `Plano de contas criado a partir de "${origem.nome}"`);
  return plano;
}

/** Cria um plano vazio para o cliente (para importar de planilha). */
export async function criarPlanoVazio(tx: Tx, autor: Autor, clienteId: string) {
  const cliente = await obterClienteVisivel(tx, autor, clienteId);
  if (!cliente) throw new ErroDeNegocio("Cliente não encontrado.");
  const existente = await tx.planoDeContas.findUnique({ where: { clienteId } });
  if (existente) return existente;
  return tx.planoDeContas.create({ data: { escritorioId: autor.escritorioId, clienteId, nome: `Plano de ${cliente.pessoa.nome}` } });
}

// ---------------------------------------------------------------------------
// Edição de contas
// ---------------------------------------------------------------------------

export async function criarConta(
  tx: Tx,
  escritorioId: string,
  planoId: string,
  e: { codigo: string; nome: string; analitica: boolean; natureza?: NaturezaConta; disponivel?: boolean; codigoReferencial?: string },
) {
  const codigo = e.codigo.trim();
  const erro = validarCodigo(codigo);
  if (erro) throw new ErroDeNegocio(erro);
  if (e.nome.trim().length < 2) throw new ErroDeNegocio("Informe o nome da conta.");
  const contas = await tx.contaContabil.findMany({ where: { planoId }, select: { codigo: true, grupo: true, analitica: true, natureza: true } });
  if (contas.some((c) => c.codigo === codigo)) throw new ErroDeNegocio(`Já existe a conta ${codigo}.`);
  const codPai = codigoDoPai(codigo, contas.map((c) => c.codigo));
  // Sob 2.3 (patrimônio líquido) o pai mais próximo é do próprio grupo; a busca simples já o encontra.
  if (!codPai) throw new ErroDeNegocio("Não achei a conta-pai. Crie primeiro a conta sintética do nível acima.");
  const pai = contas.find((c) => c.codigo === codPai)!;
  if (pai.analitica) throw new ErroDeNegocio(`A conta ${codPai} é analítica e não pode ter subcontas.`);
  await criarContas(tx, escritorioId, planoId, [{
    codigo, nome: e.nome.trim(), grupo: pai.grupo, analitica: e.analitica,
    natureza: e.natureza ?? pai.natureza, disponivel: pai.grupo === "ATIVO" && e.analitica && !!e.disponivel,
    codigoReferencial: e.codigoReferencial?.trim() || null,
  }]);
}

export async function atualizarConta(
  tx: Tx,
  contaId: string,
  e: { nome: string; natureza: NaturezaConta; ativa: boolean; disponivel: boolean; codigoReferencial?: string },
) {
  const conta = await tx.contaContabil.findUnique({ where: { id: contaId } });
  if (!conta) throw new ErroDeNegocio("Conta não encontrada.");
  if (e.nome.trim().length < 2) throw new ErroDeNegocio("Informe o nome da conta.");
  if (!e.ativa && !conta.analitica) {
    const filhasAtivas = await tx.contaContabil.count({ where: { paiId: conta.id, ativa: true } });
    if (filhasAtivas) throw new ErroDeNegocio("Inative antes as subcontas.");
  }
  await tx.contaContabil.update({
    where: { id: contaId },
    data: {
      nome: e.nome.trim(), natureza: e.natureza, ativa: e.ativa,
      disponivel: conta.grupo === "ATIVO" && conta.analitica && e.disponivel,
      codigoReferencial: e.codigoReferencial?.trim() || null,
    },
  });
}

// ---------------------------------------------------------------------------
// Importação do plano por planilha
// ---------------------------------------------------------------------------

const APELIDOS_PLANO: Record<string, string> = {
  codigo: "codigo", conta: "codigo", classificacao: "codigo", cod: "codigo",
  nome: "nome", descricao: "nome", titulo: "nome",
  tipo: "tipo", analitica: "tipo", sintetica_analitica: "tipo", s_a: "tipo",
  natureza: "natureza", d_c: "natureza",
  grupo: "grupo",
  referencial: "referencial", codigo_referencial: "referencial", conta_referencial: "referencial",
  disponivel: "disponivel", caixa: "disponivel",
};

function lerGrupo(v: string): GrupoConta | null {
  const s = normalizarCabecalho(v);
  if (!s) return null;
  if (s.startsWith("ativo")) return "ATIVO";
  if (s.startsWith("passivo")) return "PASSIVO";
  if (s.includes("patrimonio") || s === "pl") return "PATRIMONIO_LIQUIDO";
  if (s.startsWith("receita")) return "RECEITA";
  if (s.startsWith("custo")) return "CUSTO";
  if (s.startsWith("despesa")) return "DESPESA";
  if (s.includes("apuracao")) return "APURACAO";
  return null;
}

const sim = (v: string) => ["s", "sim", "x", "1", "true", "verdadeiro"].includes(normalizarCabecalho(v));

export interface LinhaPlano {
  numero: number;
  codigo: string;
  nome: string;
  acao: "criar" | "ignorar" | "erro";
  mensagens: string[];
}

/**
 * Analisa e (se não houver erros e `aplicar` for verdadeiro) cria as contas.
 * Contas já existentes (mesmo código) são ignoradas. O grupo vem da coluna
 * "grupo" ou é herdado da conta-pai.
 */
export async function importarPlano(tx: Tx, escritorioId: string, planoId: string, arquivo: { nome: string; conteudo: Buffer }, aplicar: boolean) {
  const { linhas } = await lerTabela(arquivo.nome, arquivo.conteudo, APELIDOS_PLANO, ["codigo", "nome"],
    "A primeira linha precisa ter as colunas codigo e nome (e, de preferência, tipo, natureza e grupo).");
  const existentes = await tx.contaContabil.findMany({ where: { planoId } });
  const porCodigo = new Map<string, { grupo: GrupoConta; analitica: boolean }>(existentes.map((c) => [c.codigo, c]));
  const novas: ContaNova[] = [];
  const resultado: LinhaPlano[] = [];

  // Ordena por código para que os pais venham antes dos filhos.
  const ordenadas = linhas.map((l, i) => ({ l, numero: i + 2 })).sort((a, b) => {
    const ea = validarCodigo(a.l.codigo ?? ""), eb = validarCodigo(b.l.codigo ?? "");
    return ea || eb ? 0 : compararCodigos(a.l.codigo, b.l.codigo);
  });
  for (const { l, numero } of ordenadas) {
    const codigo = (l.codigo ?? "").trim().replace(/\s/g, "");
    const nome = (l.nome ?? "").trim();
    const msgs: string[] = [];
    const erroCod = validarCodigo(codigo);
    if (erroCod) msgs.push(erroCod);
    if (nome.length < 2) msgs.push("Nome em branco.");
    if (!erroCod && porCodigo.has(codigo)) {
      resultado.push({ numero, codigo, nome, acao: "ignorar", mensagens: ["Conta já existe no plano."] });
      continue;
    }
    const tipo = normalizarCabecalho(l.tipo ?? "");
    const analitica = tipo ? ["a", "analitica", "analitico"].includes(tipo) : null;
    if (tipo && analitica === null && !["s", "sintetica", "sintetico"].includes(tipo)) msgs.push(`Tipo "${l.tipo}" não reconhecido. Use S ou A.`);
    const grupoInformado = l.grupo ? lerGrupo(l.grupo) : null;
    if (l.grupo && !grupoInformado) msgs.push(`Grupo "${l.grupo}" não reconhecido.`);
    const mapaGrupos = new Map([...porCodigo].map(([k, v]) => [k, v.grupo] as const));
    const pai = erroCod ? null : codigoDoPai(codigo, mapaGrupos, grupoInformado ?? undefined);
    const paiInfo = pai ? porCodigo.get(pai)! : null;
    if (paiInfo?.analitica) msgs.push(`A conta-pai ${pai} é analítica.`);
    const grupo = grupoInformado ?? paiInfo?.grupo ?? null;
    if (!grupo && !erroCod) msgs.push("Sem grupo: informe a coluna grupo (Ativo, Passivo, Patrimônio líquido, Receita, Custo, Despesa) ou crie a conta-pai antes.");
    const nat = normalizarCabecalho(l.natureza ?? "");
    const natureza: NaturezaConta | null = !nat ? null : nat.startsWith("d") ? "DEVEDORA" : nat.startsWith("c") ? "CREDORA" : null;
    if (nat && !natureza) msgs.push(`Natureza "${l.natureza}" não reconhecida. Use D ou C.`);
    if (msgs.length) {
      resultado.push({ numero, codigo, nome, acao: "erro", mensagens: msgs });
      continue;
    }
    const conta: ContaNova = {
      codigo, nome, grupo: grupo!, analitica: analitica ?? false,
      natureza: natureza ?? NATUREZA_PADRAO[grupo!],
      disponivel: grupo === "ATIVO" && !!analitica && sim(l.disponivel ?? ""),
      codigoReferencial: l.referencial?.trim() || null,
    };
    novas.push(conta);
    porCodigo.set(codigo, { grupo: conta.grupo, analitica: conta.analitica });
    resultado.push({ numero, codigo, nome, acao: "criar", mensagens: analitica === null ? ["Sem tipo: tratada como sintética."] : [] });
  }
  // Conta "sintética" sem filhas na planilha e sem tipo informado: avisar.
  resultado.sort((a, b) => a.numero - b.numero);
  const temErro = resultado.some((r) => r.acao === "erro");
  if (aplicar && !temErro && novas.length) await criarContas(tx, escritorioId, planoId, novas);
  return { linhas: resultado, criar: novas.length, temErro };
}

export async function planoDoCliente(tx: Tx, clienteId: string) {
  return tx.planoDeContas.findUnique({
    where: { clienteId },
    include: { contas: { orderBy: { codigo: "asc" } } },
  });
}

export function ordenarContas<T extends { codigo: string }>(contas: T[]): T[] {
  return [...contas].sort((a, b) => compararCodigos(a.codigo, b.codigo));
}

export type ContaPlano = Prisma.ContaContabilGetPayload<object>;
