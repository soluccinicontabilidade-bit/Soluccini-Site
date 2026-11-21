import { Prisma, type TransacaoBancaria } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { ErroDeNegocio } from "@/lib/erros";
import { formatarReais } from "@/lib/br";
import { obterClienteVisivel, registrarEvento } from "@/lib/clientes";
import { baixarParcela, criarTitulo, saldoDaConta, type Autor } from "./financeiro";

// ---------------------------------------------------------------------------
// Texto e pontuação
// ---------------------------------------------------------------------------

export const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const PALAVRAS_VAZIAS = new Set(["pix", "ted", "doc", "pag", "pagto", "pagamento", "receb", "recebimento", "transf", "transferencia", "boleto", "de", "da", "do", "para", "com", "ltda", "me", "sa", "eireli", "enviado", "recebido", "compra", "debito", "credito", "cartao"]);

export function palavras(s: string): Set<string> {
  return new Set(normalizar(s).split(" ").filter((p) => p.length >= 3 && !PALAVRAS_VAZIAS.has(p) && !/^\d+$/.test(p)));
}

/** Semelhança de Jaccard entre as palavras significativas (0 a 1). */
export function semelhanca(a: string, b: string): number {
  const x = palavras(a);
  const y = palavras(b);
  if (!x.size || !y.size) return 0;
  let comum = 0;
  for (const p of x) if (y.has(p)) comum++;
  return comum / (x.size + y.size - comum);
}

const dias = (a: Date, b: Date) => Math.round(Math.abs(a.getTime() - b.getTime()) / 86400_000);

/**
 * Nota de confiança (0 a 100) para uma transação do banco e um movimento do
 * sistema de mesmo valor: data (até 45 pontos), descrição (até 40) e
 * unicidade (15, se for o único candidato de mesmo valor).
 */
export function confianca(t: { data: Date; descricao: string }, m: { data: Date; texto: string }, tolerancia: number, unico: boolean): number {
  const d = dias(t.data, m.data);
  if (d > tolerancia) return 0;
  const pontosData = tolerancia === 0 ? 45 : Math.round(45 * (1 - d / (tolerancia + 1)));
  const pontosTexto = Math.round(40 * Math.min(1, semelhanca(t.descricao, m.texto) * 2));
  return Math.min(100, pontosData + pontosTexto + (unico ? 15 : 0));
}

// ---------------------------------------------------------------------------
// Candidatos
// ---------------------------------------------------------------------------

export interface Candidato {
  tipo: "parcela" | "transferencia";
  id: string;
  data: Date;
  valorCentavos: bigint; // com sinal, do ponto de vista da conta
  texto: string;
  jaBaixada: boolean;
}

async function candidatos(tx: Tx, clienteId: string, contaId: string, de: Date, ate: Date): Promise<Candidato[]> {
  const baixadas = await tx.parcela.findMany({
    where: { clienteId, contaBaixaId: contaId, situacao: "BAIXADA", conciliacaoId: null, dataBaixa: { gte: de, lte: ate } },
    include: { titulo: { include: { favorecido: true } } },
  });
  const abertas = await tx.parcela.findMany({
    where: { clienteId, situacao: { in: ["ABERTA", "APROVADA"] }, vencimento: { gte: de, lte: ate }, titulo: { canceladoEm: null }, OR: [{ contaPrevistaId: contaId }, { contaPrevistaId: null }] },
    include: { titulo: { include: { favorecido: true } } },
  });
  const transf = await tx.transferencia.findMany({
    where: { clienteId, canceladaEm: null, data: { gte: de, lte: ate }, OR: [{ origemId: contaId, conciliacaoOrigemId: null }, { destinoId: contaId, conciliacaoDestinoId: null }] },
  });
  const texto = (p: (typeof baixadas)[number]) => `${p.titulo.descricao} ${p.titulo.favorecido?.nome ?? ""} ${p.titulo.documento ?? ""}`;
  const sinal = (tipo: string) => (tipo === "RECEBER" ? 1n : -1n);
  return [
    ...baixadas.map((p) => ({ tipo: "parcela" as const, id: p.id, data: p.dataBaixa!, valorCentavos: sinal(p.titulo.tipo) * p.valorBaixaCentavos!, texto: texto(p), jaBaixada: true })),
    ...abertas.map((p) => ({ tipo: "parcela" as const, id: p.id, data: p.vencimento, valorCentavos: sinal(p.titulo.tipo) * p.valorCentavos, texto: texto(p), jaBaixada: false })),
    ...transf.map((t) => ({ tipo: "transferencia" as const, id: t.id, data: t.data, valorCentavos: t.destinoId === contaId ? t.valorCentavos : -t.valorCentavos, texto: t.descricao, jaBaixada: true })),
  ];
}

async function config(tx: Tx, clienteId: string) {
  return (await tx.configFinanceira.findUnique({ where: { clienteId } })) ?? { toleranciaDias: 3, limiteAutomatico: 95 };
}

export interface Sugestao {
  tipo: "parcela" | "transferencia";
  id: string;
  confianca: number;
  texto: string;
  jaBaixada: boolean;
}

/**
 * Calcula sugestões para as transações pendentes da conta. Concilia sozinho
 * só quando a confiança passa do limite definido pelo contador e o
 * candidato é único.
 */
export async function sugerir(tx: Tx, autor: Autor, clienteId: string, contaId: string) {
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  const cfg = await config(tx, clienteId);
  const pendentes = await tx.transacaoBancaria.findMany({ where: { contaBancariaId: contaId, clienteId, situacao: { in: ["PENDENTE", "SUGERIDA"] } }, orderBy: { data: "asc" } });
  if (!pendentes.length) return { sugeridas: 0, automaticas: 0 };
  const min = new Date(Math.min(...pendentes.map((t) => t.data.getTime())) - (cfg.toleranciaDias + 1) * 86400_000);
  const max = new Date(Math.max(...pendentes.map((t) => t.data.getTime())) + (cfg.toleranciaDias + 1) * 86400_000);
  const cands = await candidatos(tx, clienteId, contaId, min, max);
  const usados = new Set<string>();
  let sugeridas = 0;
  let automaticas = 0;
  for (const t of pendentes) {
    const mesmoValor = cands.filter((c) => c.valorCentavos === t.valorCentavos && !usados.has(c.id));
    const pontuados = mesmoValor
      .map((c) => ({ c, nota: confianca(t, { data: c.data, texto: c.texto }, cfg.toleranciaDias, mesmoValor.length === 1) }))
      .filter((x) => x.nota > 0)
      .sort((a, b) => b.nota - a.nota);
    if (!pontuados.length) {
      if (t.situacao === "SUGERIDA") await tx.transacaoBancaria.update({ where: { id: t.id }, data: { situacao: "PENDENTE", sugestao: Prisma.DbNull } });
      continue;
    }
    const melhor = pontuados[0];
    const empate = pontuados.length > 1 && pontuados[1].nota === melhor.nota;
    if (!empate && melhor.nota >= cfg.limiteAutomatico && pontuados.length === 1) {
      await conciliar(tx, autor, clienteId, contaId, { transacoes: [t.id], parcelas: melhor.c.tipo === "parcela" ? [melhor.c.id] : [], transferencias: melhor.c.tipo === "transferencia" ? [melhor.c.id] : [] }, { automatica: true, confianca: melhor.nota });
      usados.add(melhor.c.id);
      automaticas++;
      continue;
    }
    const sugestoes: Sugestao[] = pontuados.slice(0, 3).map((x) => ({ tipo: x.c.tipo, id: x.c.id, confianca: x.nota, texto: x.c.texto.trim(), jaBaixada: x.c.jaBaixada }));
    await tx.transacaoBancaria.update({ where: { id: t.id }, data: { situacao: "SUGERIDA", sugestao: sugestoes as unknown as Prisma.InputJsonValue } });
    sugeridas++;
  }
  return { sugeridas, automaticas };
}


// ---------------------------------------------------------------------------
// Conciliar e desfazer
// ---------------------------------------------------------------------------

export interface Selecao {
  transacoes: string[];
  parcelas: string[];
  transferencias: string[];
}

/**
 * Concilia N transações do banco com M movimentos do sistema (1:N, N:1 ou
 * N:M). As somas precisam ser iguais. Parcelas ainda não baixadas são
 * baixadas na data da transação. Com uma única parcela aberta e diferença
 * de valor, `ajuste` lança a diferença como juros/multa ou desconto.
 */
export async function conciliar(
  tx: Tx, autor: Autor, clienteId: string, contaId: string, s: Selecao,
  opcoes: { automatica?: boolean; confianca?: number; ajuste?: "juros" | "desconto" } = {},
) {
  if (!s.transacoes.length || !(s.parcelas.length + s.transferencias.length)) throw new ErroDeNegocio("Escolha as transações do banco e os lançamentos do sistema.");
  const trs = await tx.transacaoBancaria.findMany({ where: { id: { in: s.transacoes }, contaBancariaId: contaId, clienteId } });
  if (trs.length !== s.transacoes.length) throw new ErroDeNegocio("Transação não encontrada nesta conta.");
  if (trs.some((t) => t.situacao === "CONCILIADA" || t.situacao === "IGNORADA")) throw new ErroDeNegocio("Há transação já conciliada ou ignorada na seleção.");
  const somaBanco = trs.reduce((a, t) => a + t.valorCentavos, 0n);
  const dataBanco = trs.map((t) => t.data).sort((a, b) => b.getTime() - a.getTime())[0];

  const parcelas = await tx.parcela.findMany({ where: { id: { in: s.parcelas }, clienteId }, include: { titulo: true } });
  if (parcelas.length !== s.parcelas.length) throw new ErroDeNegocio("Parcela não encontrada.");
  const transf = await tx.transferencia.findMany({ where: { id: { in: s.transferencias }, clienteId, canceladaEm: null } });
  if (transf.length !== s.transferencias.length) throw new ErroDeNegocio("Transferência não encontrada.");

  let somaSistema = 0n;
  for (const p of parcelas) {
    if (p.conciliacaoId) throw new ErroDeNegocio(`"${p.titulo.descricao}" já está conciliada.`);
    if (p.situacao === "BAIXADA" && p.contaBaixaId !== contaId) throw new ErroDeNegocio(`"${p.titulo.descricao}" foi baixada em outra conta.`);
    if (p.situacao === "CANCELADA") throw new ErroDeNegocio(`"${p.titulo.descricao}" está cancelada.`);
    const sinal = p.titulo.tipo === "RECEBER" ? 1n : -1n;
    somaSistema += sinal * (p.situacao === "BAIXADA" ? p.valorBaixaCentavos! : p.valorCentavos);
  }
  for (const t of transf) {
    if (t.origemId !== contaId && t.destinoId !== contaId) throw new ErroDeNegocio("A transferência não é desta conta.");
    if ((t.destinoId === contaId ? t.conciliacaoDestinoId : t.conciliacaoOrigemId) !== null) throw new ErroDeNegocio("Transferência já conciliada nesta conta.");
    somaSistema += t.destinoId === contaId ? t.valorCentavos : -t.valorCentavos;
  }

  const diferenca = somaBanco - somaSistema;
  const abertas = parcelas.filter((p) => p.situacao !== "BAIXADA");
  if (diferenca !== 0n) {
    if (!opcoes.ajuste || abertas.length !== 1 || parcelas.length !== 1 || transf.length) {
      throw new ErroDeNegocio(`As somas não batem: banco ${formatarReais(somaBanco)}, sistema ${formatarReais(somaSistema)} (diferença ${formatarReais(diferenca)}). Para uma única parcela em aberto, escolha lançar a diferença como juros ou desconto.`);
    }
  }

  const conc = await tx.conciliacao.create({
    data: { escritorioId: autor.escritorioId, clienteId, contaBancariaId: contaId, automatica: !!opcoes.automatica, confianca: opcoes.confianca ?? null, criadoPorId: autor.id },
  });
  for (const p of abertas) {
    const ajuste = diferenca === 0n ? {} : (() => {
      // Diferença do ponto de vista do valor absoluto da parcela.
      const absDif = (p.titulo.tipo === "RECEBER" ? diferenca : -diferenca);
      return absDif > 0n ? { juros: formatarReais(absDif).replace("R$ ", "") } : { desconto: formatarReais(-absDif).replace("R$ ", "") };
    })();
    if (opcoes.ajuste && diferenca !== 0n && ((opcoes.ajuste === "juros") !== ("juros" in ajuste))) {
      throw new ErroDeNegocio(`A diferença é ${"juros" in ajuste ? "a maior (juros/multa)" : "a menor (desconto)"}, não ${opcoes.ajuste}.`);
    }
    // Aprovação: na conciliação o pagamento já aconteceu no banco; registra assim mesmo.
    if (p.titulo.tipo === "PAGAR" && p.situacao !== "APROVADA") {
      await tx.parcela.update({ where: { id: p.id }, data: { situacao: "APROVADA" } });
    }
    await baixarParcela(tx, autor, clienteId, p.id, { data: dataBanco.toISOString().slice(0, 10), contaId, ...ajuste });
  }
  await tx.parcela.updateMany({ where: { id: { in: parcelas.map((p) => p.id) } }, data: { conciliacaoId: conc.id } });
  for (const t of transf) {
    await tx.transferencia.update({ where: { id: t.id }, data: t.destinoId === contaId ? { conciliacaoDestinoId: conc.id } : { conciliacaoOrigemId: conc.id } });
  }
  await tx.transacaoBancaria.updateMany({ where: { id: { in: trs.map((t) => t.id) } }, data: { situacao: "CONCILIADA", conciliacaoId: conc.id } });
  await tx.$executeRaw`update transacao_bancaria set sugestao = null where conciliacao_id = ${conc.id}::uuid`;
  return conc;
}

export async function desfazerConciliacao(tx: Tx, autor: Autor, clienteId: string, conciliacaoId: string) {
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  const c = await tx.conciliacao.findFirst({ where: { id: conciliacaoId, clienteId } });
  if (!c) throw new ErroDeNegocio("Conciliação não encontrada.");
  await tx.transacaoBancaria.updateMany({ where: { conciliacaoId: c.id }, data: { situacao: "PENDENTE", conciliacaoId: null } });
  await tx.parcela.updateMany({ where: { conciliacaoId: c.id }, data: { conciliacaoId: null } });
  await tx.transferencia.updateMany({ where: { conciliacaoOrigemId: c.id }, data: { conciliacaoOrigemId: null } });
  await tx.transferencia.updateMany({ where: { conciliacaoDestinoId: c.id }, data: { conciliacaoDestinoId: null } });
  await tx.conciliacao.delete({ where: { id: c.id } });
}

export async function ignorarTransacao(tx: Tx, autor: Autor, clienteId: string, transacaoId: string, justificativa: string) {
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  if (justificativa.trim().length < 3) throw new ErroDeNegocio("Explique por que a transação será ignorada.");
  const t = await tx.transacaoBancaria.findFirst({ where: { id: transacaoId, clienteId } });
  if (!t || t.situacao === "CONCILIADA") throw new ErroDeNegocio("Transação não encontrada ou já conciliada.");
  await tx.transacaoBancaria.update({ where: { id: t.id }, data: { situacao: "IGNORADA", justificativa: justificativa.trim() } });
}

export async function reativarTransacao(tx: Tx, autor: Autor, clienteId: string, transacaoId: string) {
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  await tx.transacaoBancaria.updateMany({ where: { id: transacaoId, clienteId, situacao: "IGNORADA" }, data: { situacao: "PENDENTE", justificativa: null } });
}

// ---------------------------------------------------------------------------
// Lançar direto da transação e regras aprendidas
// ---------------------------------------------------------------------------

/** Chave da regra: as palavras significativas da descrição, em ordem. */
export function chaveRegra(descricao: string): string {
  return [...palavras(descricao)].slice(0, 4).join(" ");
}

export async function lancarDaTransacao(
  tx: Tx, autor: Autor, clienteId: string, transacaoId: string,
  e: { categoriaId: string; descricao?: string; favorecido?: string; centroCustoId?: string; criarRegra?: boolean },
) {
  const t = await tx.transacaoBancaria.findFirst({ where: { id: transacaoId, clienteId } });
  if (!t || t.situacao === "CONCILIADA" || t.situacao === "IGNORADA") throw new ErroDeNegocio("Transação não disponível.");
  const valor = formatarReais(t.valorCentavos < 0n ? -t.valorCentavos : t.valorCentavos).replace("R$ ", "");
  const dia = t.data.toISOString().slice(0, 10);
  const [titulo] = await criarTitulo(tx, autor, clienteId, {
    tipo: t.valorCentavos > 0n ? "RECEBER" : "PAGAR", descricao: e.descricao?.trim() || t.descricao, favorecido: e.favorecido,
    competencia: dia, valor, categoriaId: e.categoriaId, centroCustoId: e.centroCustoId, primeiroVencimento: dia, contaPrevistaId: t.contaBancariaId,
  });
  const parcela = await tx.parcela.findFirstOrThrow({ where: { tituloId: titulo.id } });
  if (titulo.tipo === "PAGAR") await tx.parcela.update({ where: { id: parcela.id }, data: { situacao: "APROVADA" } }); // já pago no banco
  await conciliar(tx, autor, clienteId, t.contaBancariaId, { transacoes: [t.id], parcelas: [parcela.id], transferencias: [] });
  if (e.criarRegra) {
    const texto = chaveRegra(t.descricao);
    if (texto) {
      const fav = titulo.favorecidoId;
      await tx.regraConciliacao.upsert({
        where: { clienteId_texto: { clienteId, texto } },
        create: { escritorioId: autor.escritorioId, clienteId, texto, categoriaId: e.categoriaId, favorecidoId: fav, criadoPorId: autor.id },
        update: { categoriaId: e.categoriaId, favorecidoId: fav },
      });
    }
  }
  return titulo;
}

/** Regras que casam com a descrição (todas as palavras da regra presentes). */
export function regraQueCasa<T extends { texto: string }>(regras: T[], descricao: string): T | null {
  const p = palavras(descricao);
  return regras.filter((r) => r.texto.split(" ").every((w) => p.has(w))).sort((a, b) => b.texto.length - a.texto.length)[0] ?? null;
}

/** Lança e concilia, pelas regras aprendidas, as transações pendentes que casam com alguma regra. */
export async function aplicarRegras(tx: Tx, autor: Autor, clienteId: string, contaId: string) {
  const regras = await tx.regraConciliacao.findMany({ where: { clienteId }, include: { categoria: true, favorecido: true } });
  const pendentes = await tx.transacaoBancaria.findMany({ where: { contaBancariaId: contaId, clienteId, situacao: { in: ["PENDENTE", "SUGERIDA"] } } });
  let aplicadas = 0;
  for (const t of pendentes) {
    const r = regraQueCasa(regras, t.descricao);
    if (!r || !r.categoria.ativa) continue;
    const esperado = t.valorCentavos > 0n ? "RECEITA" : "DESPESA";
    if (r.categoria.tipo !== esperado) continue;
    await lancarDaTransacao(tx, autor, clienteId, t.id, { categoriaId: r.categoriaId, favorecido: r.favorecido?.nome });
    await tx.regraConciliacao.update({ where: { id: r.id }, data: { usos: { increment: 1 } } });
    aplicadas++;
  }
  return aplicadas;
}

// ---------------------------------------------------------------------------
// Situação do mês e fechamento
// ---------------------------------------------------------------------------

const fimDoMes = (c: Date) => new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 0));

export interface Divergencias {
  pendentes: TransacaoBancaria[];
  baixasSemBanco: { id: string; descricao: string; data: Date; valor: bigint }[];
  transferenciasSemBanco: { id: string; descricao: string; data: Date; valor: bigint }[];
  saldoSistema: bigint;
  saldoExtrato: bigint | null;
  dataSaldoExtrato: Date | null;
}

export async function divergencias(tx: Tx, contaId: string, competencia: Date): Promise<Divergencias> {
  const fim = fimDoMes(competencia);
  const pendentes = await tx.transacaoBancaria.findMany({ where: { contaBancariaId: contaId, data: { gte: competencia, lte: fim }, situacao: { in: ["PENDENTE", "SUGERIDA"] } }, orderBy: { data: "asc" } });
  const baixas = await tx.parcela.findMany({ where: { contaBaixaId: contaId, situacao: "BAIXADA", conciliacaoId: null, dataBaixa: { gte: competencia, lte: fim } }, include: { titulo: true } });
  const transf = await tx.transferencia.findMany({
    where: { canceladaEm: null, data: { gte: competencia, lte: fim }, OR: [{ origemId: contaId, conciliacaoOrigemId: null }, { destinoId: contaId, conciliacaoDestinoId: null }] },
  });
  const extrato = await tx.extratoImportado.findFirst({ where: { contaBancariaId: contaId, dataSaldo: { gte: competencia, lte: fim }, saldoFinalCentavos: { not: null } }, orderBy: [{ dataSaldo: "desc" }, { criadoEm: "desc" }] });
  return {
    pendentes,
    baixasSemBanco: baixas.map((p) => ({ id: p.id, descricao: p.titulo.descricao, data: p.dataBaixa!, valor: (p.titulo.tipo === "RECEBER" ? 1n : -1n) * p.valorBaixaCentavos! })),
    transferenciasSemBanco: transf.map((t) => ({ id: t.id, descricao: t.descricao, data: t.data, valor: t.destinoId === contaId ? t.valorCentavos : -t.valorCentavos })),
    saldoSistema: await saldoDaConta(tx, contaId, extrato?.dataSaldo ?? fim),
    saldoExtrato: extrato?.saldoFinalCentavos ?? null,
    dataSaldoExtrato: extrato?.dataSaldo ?? null,
  };
}

export async function fecharConciliacao(tx: Tx, autor: Autor, clienteId: string, contaId: string, competencia: Date) {
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  const conta = await tx.contaBancaria.findFirst({ where: { id: contaId, clienteId } });
  if (!conta) throw new ErroDeNegocio("Conta não encontrada.");
  const anterior = new Date(Date.UTC(competencia.getUTCFullYear(), competencia.getUTCMonth() - 1, 1));
  const temMovAnterior = anterior >= new Date(Date.UTC(conta.dataSaldoInicial.getUTCFullYear(), conta.dataSaldoInicial.getUTCMonth(), 1));
  if (temMovAnterior) {
    const f = await tx.fechamentoConciliacao.findUnique({ where: { contaBancariaId_competencia: { contaBancariaId: contaId, competencia: anterior } } });
    if (!f?.fechado) throw new ErroDeNegocio("Feche antes a conciliação do mês anterior.");
  }
  const d = await divergencias(tx, contaId, competencia);
  const problemas: string[] = [];
  if (d.pendentes.length) problemas.push(`${d.pendentes.length} transação(ões) do banco sem conciliar`);
  if (d.baixasSemBanco.length) problemas.push(`${d.baixasSemBanco.length} baixa(s) do sistema sem transação no banco`);
  if (d.transferenciasSemBanco.length) problemas.push(`${d.transferenciasSemBanco.length} transferência(s) sem transação no banco`);
  if (d.saldoExtrato !== null && d.saldoExtrato !== d.saldoSistema) {
    problemas.push(`saldo do extrato (${formatarReais(d.saldoExtrato)}) diferente do saldo no sistema (${formatarReais(d.saldoSistema)})`);
  }
  if (problemas.length) throw new ErroDeNegocio(`Não dá para fechar: ${problemas.join("; ")}.`);
  const saldoFim = await saldoDaConta(tx, contaId, fimDoMes(competencia));
  await tx.fechamentoConciliacao.upsert({
    where: { contaBancariaId_competencia: { contaBancariaId: contaId, competencia } },
    create: { escritorioId: autor.escritorioId, contaBancariaId: contaId, competencia, saldoExtratoCentavos: d.saldoExtrato, saldoSistemaCentavos: saldoFim, fechadoPorId: autor.id },
    update: { fechado: true, saldoExtratoCentavos: d.saldoExtrato, saldoSistemaCentavos: saldoFim, fechadoPorId: autor.id, fechadoEm: new Date(), reabertoEm: null, reabertoPorId: null },
  });
  await registrarEvento(tx, autor, clienteId, "conciliacao.fechada", `Conciliação de ${conta.nome} fechada (${String(competencia.getUTCMonth() + 1).padStart(2, "0")}/${competencia.getUTCFullYear()})`);
}

export async function reabrirConciliacao(tx: Tx, autor: Autor, clienteId: string, contaId: string, competencia: Date, justificativa: string) {
  if (autor.perfil !== "CONTADOR") throw new ErroDeNegocio("Só o contador reabre uma conciliação fechada.");
  if (!justificativa.trim()) throw new ErroDeNegocio("Explique por que a conciliação está sendo reaberta.");
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  const posterior = await tx.fechamentoConciliacao.findFirst({ where: { contaBancariaId: contaId, competencia: { gt: competencia }, fechado: true } });
  if (posterior) throw new ErroDeNegocio("Reabra antes os meses seguintes.");
  const f = await tx.fechamentoConciliacao.findUnique({ where: { contaBancariaId_competencia: { contaBancariaId: contaId, competencia } } });
  if (!f?.fechado) throw new ErroDeNegocio("Este mês não está fechado.");
  await tx.fechamentoConciliacao.update({ where: { id: f.id }, data: { fechado: false, reabertoEm: new Date(), reabertoPorId: autor.id, justificativaReabertura: justificativa.trim() } });
  await registrarEvento(tx, autor, clienteId, "conciliacao.reaberta", `Conciliação reaberta: ${justificativa.trim()}`);
}
