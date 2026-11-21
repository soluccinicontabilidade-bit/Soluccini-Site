import { randomUUID } from "node:crypto";
import type { PerfilUsuario, Prisma, SituacaoParcela, TipoContaBancaria, TipoTitulo } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { ErroDeNegocio } from "@/lib/erros";
import { cifrar, indiceCego } from "@/lib/cripto";
import { cnpjValido, cpfValido, formatarReais, lerData, reaisParaCentavos, somenteDigitos } from "@/lib/br";
import { obterClienteVisivel, registrarEvento } from "@/lib/clientes";

export interface Autor {
  id: string;
  escritorioId: string;
  perfil: PerfilUsuario;
}

export const NOME_TIPO_CONTA: Record<TipoContaBancaria, string> = {
  CORRENTE: "Conta corrente",
  POUPANCA: "Poupança",
  APLICACAO: "Aplicação",
  CAIXA: "Caixa (dinheiro)",
  CARTAO_CREDITO: "Cartão de crédito",
};

export const NOME_SITUACAO_PARCELA: Record<SituacaoParcela, string> = {
  ABERTA: "Em aberto",
  AGUARDANDO_APROVACAO: "Aguardando aprovação",
  APROVADA: "Aprovada",
  REPROVADA: "Reprovada",
  BAIXADA: "Baixada",
  CANCELADA: "Cancelada",
};

async function exigirCliente(tx: Tx, autor: Autor, clienteId: string) {
  const c = await obterClienteVisivel(tx, autor, clienteId);
  if (!c) throw new ErroDeNegocio("Cliente não encontrado.");
  return c;
}

const centavos = (v: string, campo: string) => {
  try {
    return reaisParaCentavos(v);
  } catch {
    throw new ErroDeNegocio(`${campo}: valor inválido. Use o formato 1.234,56.`);
  }
};
const data = (v: string, campo: string) => {
  try {
    return lerData(v);
  } catch {
    throw new ErroDeNegocio(`${campo}: data inválida.`);
  }
};

// ---------------------------------------------------------------------------
// Categorias (plano gerencial) e centros de custo
// ---------------------------------------------------------------------------

const MODELO_CATEGORIAS: { nome: string; tipo: "RECEITA" | "DESPESA"; filhas: (string | [string, "PRO_LABORE" | "DISTRIBUICAO_LUCROS"])[] }[] = [
  { nome: "Receitas operacionais", tipo: "RECEITA", filhas: ["Vendas de mercadorias", "Vendas de produtos", "Prestação de serviços"] },
  { nome: "Receitas financeiras", tipo: "RECEITA", filhas: ["Rendimentos de aplicações", "Juros e descontos recebidos"] },
  { nome: "Outras receitas", tipo: "RECEITA", filhas: ["Aporte dos sócios", "Empréstimos recebidos", "Outras entradas"] },
  { nome: "Custos", tipo: "DESPESA", filhas: ["Compra de mercadorias", "Matéria-prima e insumos", "Serviços de terceiros"] },
  { nome: "Pessoal", tipo: "DESPESA", filhas: ["Salários", ["Pró-labore", "PRO_LABORE"], "Encargos (INSS, FGTS)", "Benefícios"] },
  { nome: "Administrativas", tipo: "DESPESA", filhas: ["Aluguel", "Energia elétrica", "Água", "Telefone e internet", "Honorários contábeis", "Sistemas e softwares", "Material de escritório", "Manutenção"] },
  { nome: "Comerciais", tipo: "DESPESA", filhas: ["Marketing e publicidade", "Comissões", "Fretes"] },
  { nome: "Tributos", tipo: "DESPESA", filhas: ["Simples Nacional", "Impostos sobre vendas", "Taxas e outros tributos", "IRPJ e CSLL"] },
  { nome: "Financeiras", tipo: "DESPESA", filhas: ["Tarifas bancárias", "Juros e multas pagos", "Taxas de cartão"] },
  { nome: "Investimentos e sócios", tipo: "DESPESA", filhas: ["Compra de equipamentos", ["Distribuição de lucros", "DISTRIBUICAO_LUCROS"], "Pagamento de empréstimos"] },
];

/** Cria as categorias padrão do cliente (se ainda não houver nenhuma). */
export async function garantirCategoriasPadrao(tx: Tx, autor: Autor, clienteId: string) {
  await exigirCliente(tx, autor, clienteId);
  if (await tx.categoriaFinanceira.count({ where: { clienteId } })) return;
  let ordem = 0;
  for (const g of MODELO_CATEGORIAS) {
    const pai = await tx.categoriaFinanceira.create({ data: { escritorioId: autor.escritorioId, clienteId, nome: g.nome, tipo: g.tipo, ordem: ordem++ } });
    for (const f of g.filhas) {
      const [nome, especial] = typeof f === "string" ? [f, "NENHUMA" as const] : f;
      await tx.categoriaFinanceira.create({ data: { escritorioId: autor.escritorioId, clienteId, paiId: pai.id, nome, tipo: g.tipo, especial, ordem: ordem++ } });
    }
  }
}

export async function criarCategoria(tx: Tx, autor: Autor, clienteId: string, e: { nome: string; paiId?: string; tipo?: "RECEITA" | "DESPESA" }) {
  await exigirCliente(tx, autor, clienteId);
  if (e.nome.trim().length < 2) throw new ErroDeNegocio("Informe o nome da categoria.");
  let tipo = e.tipo;
  if (e.paiId) {
    const pai = await tx.categoriaFinanceira.findFirst({ where: { id: e.paiId, clienteId } });
    if (!pai) throw new ErroDeNegocio("Grupo não encontrado.");
    if (pai.paiId) throw new ErroDeNegocio("As categorias têm dois níveis: grupo e categoria.");
    tipo = pai.tipo;
  }
  if (!tipo) throw new ErroDeNegocio("Escolha receita ou despesa.");
  return tx.categoriaFinanceira.create({ data: { escritorioId: autor.escritorioId, clienteId, nome: e.nome.trim(), paiId: e.paiId || null, tipo, ordem: 999 } });
}

export async function criarCentroDeCusto(tx: Tx, autor: Autor, clienteId: string, nome: string) {
  await exigirCliente(tx, autor, clienteId);
  if (nome.trim().length < 2) throw new ErroDeNegocio("Informe o nome do centro de custo.");
  const existe = await tx.centroDeCusto.findFirst({ where: { clienteId, nome: nome.trim() } });
  if (existe) throw new ErroDeNegocio("Já existe um centro de custo com este nome.");
  return tx.centroDeCusto.create({ data: { escritorioId: autor.escritorioId, clienteId, nome: nome.trim() } });
}

// ---------------------------------------------------------------------------
// Contas bancárias
// ---------------------------------------------------------------------------

export async function criarContaBancaria(
  tx: Tx,
  autor: Autor,
  clienteId: string,
  e: { nome: string; tipo: TipoContaBancaria; bancoCodigo?: string; agencia?: string; numero?: string; saldoInicial: string; dataSaldoInicial: string; contaContabilId?: string },
) {
  await exigirCliente(tx, autor, clienteId);
  if (e.nome.trim().length < 2) throw new ErroDeNegocio("Dê um nome à conta (ex.: Itaú conta movimento).");
  if (!(e.tipo in NOME_TIPO_CONTA)) throw new ErroDeNegocio("Escolha o tipo da conta.");
  if (e.contaContabilId) {
    const cc = await tx.contaContabil.findFirst({ where: { id: e.contaContabilId, plano: { clienteId }, analitica: true, disponivel: true } });
    if (!cc) throw new ErroDeNegocio("A conta contábil precisa ser analítica e marcada como caixa e equivalentes.");
    if (await tx.contaBancaria.findFirst({ where: { contaContabilId: cc.id } })) throw new ErroDeNegocio("Esta conta contábil já está ligada a outra conta bancária.");
  }
  if (await tx.contaBancaria.findFirst({ where: { clienteId, nome: e.nome.trim() } })) throw new ErroDeNegocio("Já existe uma conta com este nome.");
  const conta = await tx.contaBancaria.create({
    data: {
      escritorioId: autor.escritorioId, clienteId, nome: e.nome.trim(), tipo: e.tipo,
      bancoCodigo: e.bancoCodigo?.trim() || null, agencia: e.agencia?.trim() || null, numero: e.numero?.trim() || null,
      saldoInicialCentavos: centavos(e.saldoInicial || "0", "Saldo inicial"), dataSaldoInicial: data(e.dataSaldoInicial, "Data do saldo inicial"),
      contaContabilId: e.contaContabilId || null,
    },
  });
  await registrarEvento(tx, autor, clienteId, "financeiro.conta", `Conta bancária cadastrada: ${conta.nome}`);
  return conta;
}

/** Saldo da conta no sistema em uma data (inclusive): saldo inicial + baixas + transferências. */
export async function saldoDaConta(tx: Tx, contaId: string, ate: Date): Promise<bigint> {
  const conta = await tx.contaBancaria.findUniqueOrThrow({ where: { id: contaId } });
  if (ate < conta.dataSaldoInicial) return 0n;
  const baixas = await tx.parcela.findMany({
    where: { contaBaixaId: contaId, situacao: "BAIXADA", dataBaixa: { lte: ate } },
    select: { valorBaixaCentavos: true, titulo: { select: { tipo: true } } },
  });
  const transf = await tx.transferencia.findMany({ where: { canceladaEm: null, data: { lte: ate }, OR: [{ origemId: contaId }, { destinoId: contaId }] } });
  let s = conta.saldoInicialCentavos;
  for (const b of baixas) s += b.titulo.tipo === "RECEBER" ? b.valorBaixaCentavos! : -b.valorBaixaCentavos!;
  for (const t of transf) s += t.destinoId === contaId ? t.valorCentavos : -t.valorCentavos;
  return s;
}

// ---------------------------------------------------------------------------
// Favorecidos
// ---------------------------------------------------------------------------

/** Acha pelo documento (se houver) ou pelo nome; cria se não existir. */
export async function obterFavorecido(tx: Tx, autor: Autor, clienteId: string, nome: string, documento?: string) {
  const n = nome.trim();
  if (!n) return null;
  const doc = somenteDigitos(documento ?? "");
  if (doc) {
    if (!cpfValido(doc) && !cnpjValido(doc)) throw new ErroDeNegocio("CPF/CNPJ do favorecido inválido.");
    const hash = indiceCego(doc);
    const existente = await tx.favorecido.findFirst({ where: { clienteId, documentoHash: hash } });
    if (existente) return existente;
    // Se o documento for de uma pessoa cadastrada (ex.: sócio), liga as duas.
    const pessoa = await tx.pessoa.findUnique({ where: { escritorioId_documentoHash: { escritorioId: autor.escritorioId, documentoHash: hash } } });
    return tx.favorecido.create({
      data: { escritorioId: autor.escritorioId, clienteId, nome: n, documentoCifrado: cifrar(doc), documentoHash: hash, documentoFinal: doc.slice(-4), pessoaId: pessoa?.id ?? null },
    });
  }
  const porNome = await tx.favorecido.findFirst({ where: { clienteId, nome: { equals: n, mode: "insensitive" } } });
  return porNome ?? tx.favorecido.create({ data: { escritorioId: autor.escritorioId, clienteId, nome: n } });
}

// ---------------------------------------------------------------------------
// Títulos (contas a pagar e a receber)
// ---------------------------------------------------------------------------

export interface RateioEntrada {
  categoriaId: string;
  centroCustoId?: string;
  valor: string;
}

export interface TituloEntrada {
  tipo: TipoTitulo;
  descricao: string;
  favorecido?: string;
  documentoFavorecido?: string;
  documento?: string;
  competencia: string; // data ou aaaa-mm
  valor: string;
  rateios?: RateioEntrada[]; // vazio = uma única categoria em categoriaId
  categoriaId?: string;
  centroCustoId?: string;
  parcelas?: number;
  primeiroVencimento: string;
  contaPrevistaId?: string;
  repetirMeses?: number; // recorrência: cria o mesmo título nos meses seguintes
  observacao?: string;
}

/** Divide o valor em n parcelas iguais; a última leva a diferença de centavos. */
export function dividirEmParcelas(total: bigint, n: number): bigint[] {
  const base = total / BigInt(n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - base * BigInt(n - 1) : base));
}

export function somarMeses(d: Date, meses: number): Date {
  const ano = d.getUTCFullYear();
  const mes = d.getUTCMonth() + meses;
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes, Math.min(d.getUTCDate(), ultimoDia)));
}

async function validarRateios(tx: Tx, clienteId: string, tipo: TipoTitulo, total: bigint, e: TituloEntrada) {
  const rateios = e.rateios?.length ? e.rateios : [{ categoriaId: e.categoriaId ?? "", centroCustoId: e.centroCustoId, valor: formatarReais(total).replace("R$ ", "") }];
  const resolvidos = [];
  let soma = 0n;
  for (const [i, r] of rateios.entries()) {
    const cat = await tx.categoriaFinanceira.findFirst({ where: { id: r.categoriaId, clienteId, ativa: true } });
    if (!cat) throw new ErroDeNegocio(rateios.length > 1 ? `Rateio ${i + 1}: escolha a categoria.` : "Escolha a categoria.");
    if (!cat.paiId) throw new ErroDeNegocio(`"${cat.nome}" é um grupo. Escolha uma categoria dentro dele.`);
    const esperado = tipo === "RECEBER" ? "RECEITA" : "DESPESA";
    if (cat.tipo !== esperado) throw new ErroDeNegocio(`A categoria "${cat.nome}" é de ${cat.tipo === "RECEITA" ? "receita" : "despesa"}; este título é a ${tipo === "PAGAR" ? "pagar" : "receber"}.`);
    if (r.centroCustoId && !(await tx.centroDeCusto.findFirst({ where: { id: r.centroCustoId, clienteId } }))) throw new ErroDeNegocio("Centro de custo inválido.");
    const v = centavos(r.valor, `Rateio ${i + 1}`);
    if (v <= 0n) throw new ErroDeNegocio(`Rateio ${i + 1}: o valor precisa ser maior que zero.`);
    soma += v;
    resolvidos.push({ categoriaId: cat.id, centroCustoId: r.centroCustoId || null, valorCentavos: v });
  }
  if (soma !== total) throw new ErroDeNegocio(`A soma dos rateios (${formatarReais(soma)}) é diferente do valor do título (${formatarReais(total)}).`);
  return resolvidos;
}

export async function criarTitulo(tx: Tx, autor: Autor, clienteId: string, e: TituloEntrada) {
  await exigirCliente(tx, autor, clienteId);
  if (e.tipo !== "PAGAR" && e.tipo !== "RECEBER") throw new ErroDeNegocio("Escolha pagar ou receber.");
  if (!e.descricao.trim()) throw new ErroDeNegocio("Descreva o título.");
  const total = centavos(e.valor, "Valor");
  if (total <= 0n) throw new ErroDeNegocio("O valor precisa ser maior que zero.");
  const nParcelas = Math.trunc(e.parcelas ?? 1);
  if (nParcelas < 1 || nParcelas > 120) throw new ErroDeNegocio("Parcelas: de 1 a 120.");
  const repetir = Math.trunc(e.repetirMeses ?? 0);
  if (repetir < 0 || repetir > 60) throw new ErroDeNegocio("Repetição: até 60 meses.");
  if (repetir > 0 && nParcelas > 1) throw new ErroDeNegocio("Use parcelamento ou repetição mensal, não os dois.");
  const competencia = data(/^\d{4}-\d{2}$/.test(e.competencia) ? `${e.competencia}-01` : e.competencia, "Competência");
  const venc = data(e.primeiroVencimento, "Vencimento");
  if (e.contaPrevistaId && !(await tx.contaBancaria.findFirst({ where: { id: e.contaPrevistaId, clienteId } }))) throw new ErroDeNegocio("Conta bancária inválida.");
  const rateios = await validarRateios(tx, clienteId, e.tipo, total, e);
  const favorecido = e.favorecido ? await obterFavorecido(tx, autor, clienteId, e.favorecido, e.documentoFavorecido) : null;
  const grupo = repetir > 0 ? randomUUID() : null;
  const criados = [];
  for (let m = 0; m <= repetir; m++) {
    const valores = dividirEmParcelas(total, nParcelas);
    const t = await tx.tituloFinanceiro.create({
      data: {
        escritorioId: autor.escritorioId, clienteId, tipo: e.tipo, descricao: e.descricao.trim(), favorecidoId: favorecido?.id ?? null,
        documento: e.documento?.trim() || null, competencia: somarMeses(competencia, m), valorCentavos: total, grupoRecorrencia: grupo,
        observacao: e.observacao?.trim() || null, criadoPorId: autor.id,
        rateios: { create: rateios.map((r) => ({ ...r, escritorioId: autor.escritorioId })) },
        parcelas: {
          create: valores.map((v, i) => ({
            escritorioId: autor.escritorioId, clienteId, numero: i + 1, total: nParcelas, valorCentavos: v,
            vencimento: somarMeses(venc, m + i), contaPrevistaId: e.contaPrevistaId || null,
          })),
        },
      },
    });
    criados.push(t);
  }
  return criados;
}

export async function cancelarTitulo(tx: Tx, autor: Autor, clienteId: string, tituloId: string, motivo: string) {
  await exigirCliente(tx, autor, clienteId);
  const t = await tx.tituloFinanceiro.findFirst({ where: { id: tituloId, clienteId }, include: { parcelas: true } });
  if (!t || t.canceladoEm) throw new ErroDeNegocio("Título não encontrado.");
  if (!motivo.trim()) throw new ErroDeNegocio("Informe o motivo do cancelamento.");
  if (t.parcelas.some((p) => p.situacao === "BAIXADA")) throw new ErroDeNegocio("Há parcelas baixadas. Estorne as baixas antes de cancelar.");
  await tx.parcela.updateMany({ where: { tituloId }, data: { situacao: "CANCELADA" } });
  await tx.tituloFinanceiro.update({ where: { id: tituloId }, data: { canceladoEm: new Date(), motivoCancelamento: motivo.trim() } });
}

// ---------------------------------------------------------------------------
// Aprovação e baixa
// ---------------------------------------------------------------------------

/** O cliente aprova pagamentos se tiver pelo menos um usuário aprovador ativo. */
export async function exigeAprovacao(tx: Tx, clienteId: string) {
  return (await tx.acessoCliente.count({ where: { clienteId, usuario: { perfil: "CLIENTE_APROVADOR", ativo: true } } })) > 0;
}

export async function pedirAprovacao(tx: Tx, autor: Autor, clienteId: string, parcelaIds: string[]) {
  await exigirCliente(tx, autor, clienteId);
  const ps = await tx.parcela.findMany({ where: { id: { in: parcelaIds }, clienteId }, include: { titulo: true } });
  if (!ps.length) throw new ErroDeNegocio("Escolha as parcelas.");
  for (const p of ps) {
    if (p.titulo.tipo !== "PAGAR") throw new ErroDeNegocio("Só pagamentos passam por aprovação.");
    if (p.situacao !== "ABERTA" && p.situacao !== "REPROVADA") throw new ErroDeNegocio(`A parcela de "${p.titulo.descricao}" está ${NOME_SITUACAO_PARCELA[p.situacao].toLowerCase()}.`);
  }
  await tx.parcela.updateMany({ where: { id: { in: ps.map((p) => p.id) } }, data: { situacao: "AGUARDANDO_APROVACAO", aprovacaoPedidaEm: new Date(), motivoReprovacao: null } });
  await registrarEvento(tx, autor, clienteId, "financeiro.aprovacao", `${ps.length} pagamento(s) enviado(s) para aprovação do cliente`);
  return ps.length;
}

/** Decisão do cliente aprovador (portal). */
export async function decidirAprovacao(tx: Tx, aprovador: Autor, clienteId: string, parcelaId: string, aprovar: boolean, motivo?: string) {
  if (aprovador.perfil !== "CLIENTE_APROVADOR") throw new ErroDeNegocio("Só o aprovador do cliente decide pagamentos.");
  const acesso = await tx.acessoCliente.findFirst({ where: { usuarioId: aprovador.id, clienteId } });
  if (!acesso) throw new ErroDeNegocio("Sem acesso a este cliente.");
  const p = await tx.parcela.findFirst({ where: { id: parcelaId, clienteId }, include: { titulo: true } });
  if (!p || p.situacao !== "AGUARDANDO_APROVACAO") throw new ErroDeNegocio("Este pagamento não está aguardando aprovação.");
  if (!aprovar && !motivo?.trim()) throw new ErroDeNegocio("Explique por que o pagamento não foi aprovado.");
  await tx.parcela.update({
    where: { id: p.id },
    data: aprovar ? { situacao: "APROVADA", aprovadoPorId: aprovador.id, aprovadoEm: new Date() } : { situacao: "REPROVADA", motivoReprovacao: motivo!.trim() },
  });
  await tx.eventoCliente.create({
    data: { escritorioId: aprovador.escritorioId, clienteId, tipo: "financeiro.decisao", resumo: `Pagamento ${aprovar ? "aprovado" : "não aprovado"} pelo cliente: ${p.titulo.descricao} (${formatarReais(p.valorCentavos)})`, usuarioId: aprovador.id },
  });
}

export interface BaixaEntrada {
  data: string;
  contaId: string;
  juros?: string;
  multa?: string;
  desconto?: string;
}

export async function baixarParcela(tx: Tx, autor: Autor, clienteId: string, parcelaId: string, e: BaixaEntrada) {
  await exigirCliente(tx, autor, clienteId);
  const p = await tx.parcela.findFirst({ where: { id: parcelaId, clienteId }, include: { titulo: true } });
  if (!p) throw new ErroDeNegocio("Parcela não encontrada.");
  if (p.situacao === "BAIXADA") throw new ErroDeNegocio("Esta parcela já foi baixada.");
  if (p.situacao === "CANCELADA") throw new ErroDeNegocio("Parcela cancelada.");
  if (p.titulo.tipo === "PAGAR" && (await exigeAprovacao(tx, clienteId)) && p.situacao !== "APROVADA") {
    throw new ErroDeNegocio("Este cliente aprova os pagamentos. Envie para aprovação e aguarde.");
  }
  const conta = await tx.contaBancaria.findFirst({ where: { id: e.contaId, clienteId, ativa: true } });
  if (!conta) throw new ErroDeNegocio("Escolha a conta bancária da baixa.");
  const dia = data(e.data, "Data da baixa");
  if (dia < conta.dataSaldoInicial) throw new ErroDeNegocio("A data é anterior ao saldo inicial da conta.");
  const juros = centavos(e.juros || "0", "Juros");
  const multa = centavos(e.multa || "0", "Multa");
  const desconto = centavos(e.desconto || "0", "Desconto");
  if (juros < 0n || multa < 0n || desconto < 0n) throw new ErroDeNegocio("Juros, multa e desconto não podem ser negativos.");
  const valorBaixa = p.valorCentavos + juros + multa - desconto;
  if (valorBaixa <= 0n) throw new ErroDeNegocio("O desconto não pode ser maior que o valor.");
  await tx.parcela.update({
    where: { id: p.id },
    data: {
      situacao: "BAIXADA", dataBaixa: dia, contaBaixaId: conta.id, valorBaixaCentavos: valorBaixa,
      jurosCentavos: juros, multaCentavos: multa, descontoCentavos: desconto, baixadoPorId: autor.id, baixadoEm: new Date(),
    },
  });
  return valorBaixa;
}

export async function estornarBaixa(tx: Tx, autor: Autor, clienteId: string, parcelaId: string) {
  await exigirCliente(tx, autor, clienteId);
  const p = await tx.parcela.findFirst({ where: { id: parcelaId, clienteId } });
  if (!p || p.situacao !== "BAIXADA") throw new ErroDeNegocio("Parcela não está baixada.");
  if (p.conciliacaoId) throw new ErroDeNegocio("A baixa está conciliada. Desfaça a conciliação antes.");
  await tx.parcela.update({
    where: { id: p.id },
    data: {
      situacao: p.aprovadoEm ? "APROVADA" : "ABERTA", dataBaixa: null, contaBaixaId: null, valorBaixaCentavos: null,
      jurosCentavos: 0n, multaCentavos: 0n, descontoCentavos: 0n, baixadoPorId: null, baixadoEm: null,
    },
  });
}

export async function criarTransferencia(tx: Tx, autor: Autor, clienteId: string, e: { origemId: string; destinoId: string; data: string; valor: string; descricao?: string }) {
  await exigirCliente(tx, autor, clienteId);
  if (e.origemId === e.destinoId) throw new ErroDeNegocio("Escolha contas diferentes.");
  const contas = await tx.contaBancaria.findMany({ where: { id: { in: [e.origemId, e.destinoId] }, clienteId, ativa: true } });
  if (contas.length !== 2) throw new ErroDeNegocio("Escolha as duas contas.");
  const valor = centavos(e.valor, "Valor");
  if (valor <= 0n) throw new ErroDeNegocio("O valor precisa ser maior que zero.");
  return tx.transferencia.create({
    data: { escritorioId: autor.escritorioId, clienteId, origemId: e.origemId, destinoId: e.destinoId, data: data(e.data, "Data"), valorCentavos: valor, descricao: e.descricao?.trim() || "Transferência entre contas", criadoPorId: autor.id },
  });
}

// ---------------------------------------------------------------------------
// Rotina mensal do BPO
// ---------------------------------------------------------------------------

export const ROTINA_BPO = [
  "Importar os extratos de todas as contas",
  "Conciliar as transações do mês",
  "Lançar contas a pagar e a receber novas",
  "Enviar pagamentos para aprovação do cliente",
  "Agendar os pagamentos aprovados",
  "Cobrar os recebimentos vencidos",
  "Fechar a conciliação das contas",
  "Enviar o relatório do mês ao cliente",
];

export async function rotinaDoMes(tx: Tx, autor: Autor, clienteId: string, competencia: Date) {
  await exigirCliente(tx, autor, clienteId);
  const itens = await tx.itemChecklistBpo.findMany({ where: { clienteId, competencia }, orderBy: { ordem: "asc" } });
  if (itens.length) return itens;
  await tx.itemChecklistBpo.createMany({
    data: ROTINA_BPO.map((descricao, ordem) => ({ escritorioId: autor.escritorioId, clienteId, competencia, ordem, descricao })),
  });
  return tx.itemChecklistBpo.findMany({ where: { clienteId, competencia }, orderBy: { ordem: "asc" } });
}

export type ParcelaComTitulo = Prisma.ParcelaGetPayload<{ include: { titulo: { include: { favorecido: true; rateios: { include: { categoria: true } } } } } }>;
