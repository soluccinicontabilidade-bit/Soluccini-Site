import type { OrigemLancamento, PerfilUsuario, SituacaoPeriodo, TipoPartida } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { ErroDeNegocio } from "@/lib/erros";
import { dataCivil, formatarReais, lerData, reaisParaCentavos } from "@/lib/br";
import { sha256 } from "@/lib/cripto";
import { obterClienteVisivel, registrarEvento } from "@/lib/clientes";
import { lerTabela, normalizarCabecalho } from "@/lib/planilha";

interface Autor {
  id: string;
  escritorioId: string;
  perfil: PerfilUsuario;
}

export const NOME_ORIGEM: Record<OrigemLancamento, string> = {
  MANUAL: "Manual",
  AJUSTE: "Ajuste",
  PROVISAO: "Provisão",
  SALDO_INICIAL: "Saldo inicial",
  IMPORTACAO: "Importação",
  FINANCEIRO: "Financeiro",
  ENCERRAMENTO: "Apuração do resultado",
  ESTORNO: "Estorno",
};

export const NOME_SITUACAO_PERIODO: Record<SituacaoPeriodo, string> = {
  ABERTO: "Aberto",
  EM_CONFERENCIA: "Em conferência",
  FECHADO: "Fechado",
};

export const ORIGENS_EDITAVEIS: OrigemLancamento[] = ["MANUAL", "AJUSTE", "PROVISAO"];

export const competenciaDe = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/** "2026-03" ou "03/2026" -> Date(2026-03-01). */
export function lerCompetencia(s: string): Date {
  const iso = s.match(/^(\d{4})-(\d{2})$/);
  const br = s.match(/^(\d{2})\/(\d{4})$/);
  try {
    if (iso) return dataCivil(`${iso[1]}-${iso[2]}-01`);
    if (br) return dataCivil(`${br[2]}-${br[1]}-01`);
  } catch {
    /* cai no erro abaixo */
  }
  throw new ErroDeNegocio("Competência inválida. Use mm/aaaa.");
}

export const rotuloCompetencia = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
export const isoCompetencia = (d: Date) => d.toISOString().slice(0, 7);

export async function obterOuCriarPeriodo(tx: Tx, escritorioId: string, clienteId: string, data: Date) {
  const competencia = competenciaDe(data);
  const existente = await tx.periodoContabil.findUnique({ where: { clienteId_competencia: { clienteId, competencia } } });
  if (existente) return existente;
  return tx.periodoContabil.create({ data: { escritorioId, clienteId, competencia } });
}

export interface PartidaEntrada {
  conta: string; // código da conta ("1.1.1.01") ou "código - nome"
  tipo: TipoPartida;
  valor: string; // "1.234,56"
  historico?: string;
}

export interface LancamentoEntrada {
  data: string;
  historico: string;
  origem?: OrigemLancamento;
  justificativa?: string;
  partidas: PartidaEntrada[];
}

/** Valida e resolve as partidas contra o plano do cliente. Erros vêm com o número da linha. */
async function prepararPartidas(tx: Tx, clienteId: string, partidas: PartidaEntrada[]) {
  const plano = await tx.planoDeContas.findUnique({ where: { clienteId }, include: { contas: true } });
  if (!plano) throw new ErroDeNegocio("Este cliente ainda não tem plano de contas.");
  const porCodigo = new Map(plano.contas.map((c) => [c.codigo, c]));
  const usadas = partidas.filter((p) => p.conta.trim() || p.valor.trim());
  if (usadas.length < 2) throw new ErroDeNegocio("Um lançamento precisa de pelo menos uma partida a débito e uma a crédito.");
  let debitos = 0n;
  let creditos = 0n;
  const resolvidas = usadas.map((p, i) => {
    const codigo = p.conta.split(" ")[0].trim();
    const conta = porCodigo.get(codigo);
    if (!conta) throw new ErroDeNegocio(`Linha ${i + 1}: conta "${codigo}" não existe no plano deste cliente.`);
    if (!conta.analitica) throw new ErroDeNegocio(`Linha ${i + 1}: a conta ${codigo} é sintética. Use uma conta analítica.`);
    if (!conta.ativa) throw new ErroDeNegocio(`Linha ${i + 1}: a conta ${codigo} está inativa.`);
    let valor: bigint;
    try {
      valor = reaisParaCentavos(p.valor);
    } catch {
      throw new ErroDeNegocio(`Linha ${i + 1}: valor inválido. Use o formato 1.234,56.`);
    }
    if (valor <= 0n) throw new ErroDeNegocio(`Linha ${i + 1}: o valor precisa ser maior que zero.`);
    if (p.tipo !== "DEBITO" && p.tipo !== "CREDITO") throw new ErroDeNegocio(`Linha ${i + 1}: escolha débito ou crédito.`);
    if (p.tipo === "DEBITO") debitos += valor;
    else creditos += valor;
    return { contaId: conta.id, tipo: p.tipo, valorCentavos: valor, historicoComplementar: p.historico?.trim() || null, ordem: i + 1 };
  });
  if (debitos === 0n || creditos === 0n) throw new ErroDeNegocio("O lançamento precisa ter débito e crédito.");
  if (debitos !== creditos) {
    throw new ErroDeNegocio(`Débitos (${formatarReais(debitos)}) e créditos (${formatarReais(creditos)}) não fecham. Diferença: ${formatarReais(debitos - creditos)}.`);
  }
  return resolvidas;
}

function exigirPeriodoAberto(p: { situacao: SituacaoPeriodo; competencia: Date }) {
  if (p.situacao !== "ABERTO") {
    throw new ErroDeNegocio(`O período ${rotuloCompetencia(p.competencia)} está ${NOME_SITUACAO_PERIODO[p.situacao].toLowerCase()}. Ele precisa estar aberto para receber ou alterar lançamentos.`);
  }
}

export async function criarLancamento(tx: Tx, autor: Autor, clienteId: string, e: LancamentoEntrada, extras?: { chaveOrigem?: string; estornaId?: string }) {
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  const origem = e.origem ?? "MANUAL";
  if (!e.historico.trim()) throw new ErroDeNegocio("Escreva o histórico do lançamento.");
  if (["AJUSTE", "PROVISAO", "ESTORNO"].includes(origem) && !e.justificativa?.trim()) {
    throw new ErroDeNegocio("Ajustes, provisões e estornos precisam de justificativa.");
  }
  let data: Date;
  try {
    data = lerData(e.data);
  } catch {
    throw new ErroDeNegocio("Informe a data do lançamento.");
  }
  const partidas = await prepararPartidas(tx, clienteId, e.partidas);
  const periodo = await obterOuCriarPeriodo(tx, autor.escritorioId, clienteId, data);
  exigirPeriodoAberto(periodo);
  const lanc = await tx.lancamentoContabil.create({
    data: {
      escritorioId: autor.escritorioId, clienteId, periodoId: periodo.id, data, historico: e.historico.trim(), origem,
      justificativa: e.justificativa?.trim() || null, criadoPorId: autor.id, chaveOrigem: extras?.chaveOrigem, estornaId: extras?.estornaId,
      partidas: { create: partidas.map((p) => ({ ...p, escritorioId: autor.escritorioId })) },
    },
  });
  return tx.lancamentoContabil.findUniqueOrThrow({ where: { id: lanc.id } }); // número atribuído pelo banco
}

export async function editarLancamento(tx: Tx, autor: Autor, clienteId: string, lancamentoId: string, e: LancamentoEntrada) {
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  const atual = await tx.lancamentoContabil.findFirst({ where: { id: lancamentoId, clienteId }, include: { periodo: true, estornadoPor: true } });
  if (!atual || atual.excluidoEm) throw new ErroDeNegocio("Lançamento não encontrado.");
  if (!ORIGENS_EDITAVEIS.includes(atual.origem)) throw new ErroDeNegocio(`Lançamentos de ${NOME_ORIGEM[atual.origem].toLowerCase()} não são editados. Faça um estorno.`);
  if (atual.estornadoPor) throw new ErroDeNegocio("Este lançamento já foi estornado.");
  exigirPeriodoAberto(atual.periodo);
  const origem = e.origem && ORIGENS_EDITAVEIS.includes(e.origem) ? e.origem : atual.origem;
  if (origem !== "MANUAL" && !e.justificativa?.trim()) throw new ErroDeNegocio("Ajustes e provisões precisam de justificativa.");
  if (!e.historico.trim()) throw new ErroDeNegocio("Escreva o histórico do lançamento.");
  const data = lerData(e.data);
  const partidas = await prepararPartidas(tx, clienteId, e.partidas);
  const periodo = await obterOuCriarPeriodo(tx, autor.escritorioId, clienteId, data);
  exigirPeriodoAberto(periodo);
  await tx.partida.deleteMany({ where: { lancamentoId } });
  await tx.lancamentoContabil.update({
    where: { id: lancamentoId },
    data: {
      data, periodoId: periodo.id, historico: e.historico.trim(), origem, justificativa: e.justificativa?.trim() || null,
      partidas: { create: partidas.map((p) => ({ ...p, escritorioId: autor.escritorioId })) },
    },
  });
}

/** Estorno: novo lançamento com as partidas invertidas, ligado ao original. */
export async function estornarLancamento(tx: Tx, autor: Autor, clienteId: string, lancamentoId: string, dataEstorno: string, justificativa: string) {
  const original = await tx.lancamentoContabil.findFirst({
    where: { id: lancamentoId, clienteId, excluidoEm: null },
    include: { partidas: { include: { conta: true }, orderBy: { ordem: "asc" } }, estornadoPor: true },
  });
  if (!original) throw new ErroDeNegocio("Lançamento não encontrado.");
  if (original.origem === "ESTORNO") throw new ErroDeNegocio("Não se estorna um estorno. Lance de novo, se for o caso.");
  if (original.estornadoPor) throw new ErroDeNegocio(`Este lançamento já foi estornado pelo nº ${original.estornadoPor.numero}.`);
  const est = await criarLancamento(tx, autor, clienteId, {
    data: dataEstorno,
    historico: `Estorno do lançamento nº ${original.numero}: ${original.historico}`.slice(0, 500),
    origem: "ESTORNO",
    justificativa,
    partidas: original.partidas.map((p) => ({
      conta: p.conta.codigo,
      tipo: p.tipo === "DEBITO" ? "CREDITO" : "DEBITO",
      valor: formatarReais(p.valorCentavos).replace("R$ ", ""),
      historico: p.historicoComplementar ?? undefined,
    })),
  }, { estornaId: original.id });
  await registrarEvento(tx, autor, clienteId, "lancamento.estorno", `Lançamento nº ${original.numero} estornado pelo nº ${est.numero}`);
  return est;
}

// ---------------------------------------------------------------------------
// Saldos iniciais por planilha
// ---------------------------------------------------------------------------

const APELIDOS_SALDO: Record<string, string> = {
  conta: "conta", codigo: "conta", classificacao: "conta",
  nome: "nome", descricao: "nome",
  debito: "debito", devedor: "debito", saldo_devedor: "debito",
  credito: "credito", credor: "credito", saldo_credor: "credito",
  saldo: "saldo", valor: "saldo",
  natureza: "natureza", d_c: "natureza",
};

export interface LinhaSaldo {
  numero: number;
  conta: string;
  nome: string;
  tipo?: TipoPartida;
  valor?: bigint;
  mensagens: string[];
}

/** Lê as linhas da planilha de saldos sem gravar nada. */
export async function analisarSaldosIniciais(tx: Tx, clienteId: string, arquivo: { nome: string; conteudo: Buffer }) {
  const { linhas } = await lerTabela(arquivo.nome, arquivo.conteudo, APELIDOS_SALDO, ["conta"],
    "A primeira linha precisa ter a coluna conta e as colunas debito e credito (ou saldo e natureza).");
  const plano = await tx.planoDeContas.findUnique({ where: { clienteId }, include: { contas: true } });
  if (!plano) throw new ErroDeNegocio("Crie o plano de contas do cliente antes dos saldos iniciais.");
  const porCodigo = new Map(plano.contas.map((c) => [c.codigo, c]));
  const vistos = new Set<string>();
  const valor = (s?: string) => (s && s.trim() ? reaisParaCentavos(s.replace(/^-/, "")) : 0n);
  const resultado: LinhaSaldo[] = linhas.map((l, i) => {
    const numero = i + 2;
    const conta = (l.conta ?? "").trim();
    const r: LinhaSaldo = { numero, conta, nome: porCodigo.get(conta)?.nome ?? l.nome ?? "", mensagens: [] };
    const c = porCodigo.get(conta);
    if (!c) r.mensagens.push(`Conta ${conta || "(em branco)"} não existe no plano.`);
    else if (!c.analitica) r.mensagens.push(`Conta ${conta} é sintética. Informe o saldo nas analíticas.`);
    if (vistos.has(conta)) r.mensagens.push("Conta repetida na planilha.");
    vistos.add(conta);
    try {
      if (l.debito !== undefined || l.credito !== undefined) {
        const d = valor(l.debito);
        const cr = valor(l.credito);
        if (d && cr) r.mensagens.push("Preencha débito ou crédito, não os dois.");
        r.tipo = d ? "DEBITO" : "CREDITO";
        r.valor = d || cr;
      } else {
        const v = valor(l.saldo);
        const nat = normalizarCabecalho(l.natureza ?? "");
        const negativo = (l.saldo ?? "").trim().startsWith("-");
        let tipo: TipoPartida | null = nat.startsWith("d") ? "DEBITO" : nat.startsWith("c") ? "CREDITO" : null;
        if (!tipo && c) tipo = c.natureza === "DEVEDORA" ? "DEBITO" : "CREDITO";
        if (tipo && negativo) tipo = tipo === "DEBITO" ? "CREDITO" : "DEBITO";
        r.tipo = tipo ?? "DEBITO";
        r.valor = v;
      }
    } catch {
      r.mensagens.push("Valor inválido. Use o formato 1.234,56.");
    }
    return r;
  }).filter((r) => r.mensagens.length > 0 || (r.valor ?? 0n) > 0n);
  const debitos = resultado.reduce((s, r) => s + (r.tipo === "DEBITO" ? r.valor ?? 0n : 0n), 0n);
  const creditos = resultado.reduce((s, r) => s + (r.tipo === "CREDITO" ? r.valor ?? 0n : 0n), 0n);
  return { linhas: resultado, debitos, creditos, temErro: resultado.some((r) => r.mensagens.length > 0), hash: sha256(arquivo.conteudo) };
}

export async function aplicarSaldosIniciais(tx: Tx, autor: Autor, clienteId: string, data: string, arquivo: { nome: string; conteudo: Buffer }) {
  const a = await analisarSaldosIniciais(tx, clienteId, arquivo);
  if (a.temErro) throw new ErroDeNegocio("Corrija as linhas com erro antes de aplicar.");
  if (a.debitos !== a.creditos) {
    throw new ErroDeNegocio(`Os saldos não fecham: devedores ${formatarReais(a.debitos)}, credores ${formatarReais(a.creditos)}. Diferença de ${formatarReais(a.debitos - a.creditos)}.`);
  }
  if (a.debitos === 0n) throw new ErroDeNegocio("A planilha não tem saldos.");
  const ativo = await tx.lancamentoContabil.findFirst({ where: { clienteId, origem: "SALDO_INICIAL", excluidoEm: null, estornadoPor: null } });
  if (ativo) throw new ErroDeNegocio(`Já existem saldos iniciais (lançamento nº ${ativo.numero}). Estorne-o para importar outros.`);
  const plano = await tx.planoDeContas.findUniqueOrThrow({ where: { clienteId }, include: { contas: true } });
  const nomes = new Map(plano.contas.map((c) => [c.codigo, c.codigo]));
  const lanc = await criarLancamento(tx, autor, clienteId, {
    data,
    historico: `Saldos iniciais importados de ${arquivo.nome}`.slice(0, 500),
    origem: "SALDO_INICIAL",
    partidas: a.linhas.map((l) => ({ conta: nomes.get(l.conta)!, tipo: l.tipo!, valor: formatarReais(l.valor!).replace("R$ ", "") })),
  }, { chaveOrigem: `saldo-inicial:${a.hash}:${(await tx.lancamentoContabil.count({ where: { clienteId, origem: "SALDO_INICIAL" } })) + 1}` });
  await registrarEvento(tx, autor, clienteId, "saldos.iniciais", `Saldos iniciais lançados (nº ${lanc.numero})`);
  return lanc;
}

export function modeloSaldosCsv(): string {
  return "﻿" + ["conta;nome;debito;credito", "1.1.1.02;Bancos conta movimento;15.000,00;", "2.3.1.01;Capital subscrito;;15.000,00"].join("\r\n") + "\r\n";
}

export function modeloPlanoCsv(): string {
  return "﻿" + [
    "codigo;nome;tipo;natureza;grupo;disponivel;referencial",
    "1;Ativo;S;D;Ativo;;",
    "1.1;Ativo circulante;S;D;Ativo;;",
    "1.1.1;Disponível;S;D;Ativo;;",
    "1.1.1.01;Caixa;A;D;Ativo;sim;",
  ].join("\r\n") + "\r\n";
}
