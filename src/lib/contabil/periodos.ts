import type { PerfilUsuario, SituacaoPeriodo } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { ErroDeNegocio } from "@/lib/erros";
import { dataCivil, formatarReais } from "@/lib/br";
import { obterClienteVisivel, registrarEvento } from "@/lib/clientes";
import { balanceteFecha, calcularSaldos, type ContaR, type PartidaR } from "./relatorios";
import { criarLancamento, NOME_SITUACAO_PERIODO, rotuloCompetencia } from "./lancamentos";
import { GRUPOS_RESULTADO } from "./plano";

interface Autor {
  id: string;
  escritorioId: string;
  perfil: PerfilUsuario;
}

/** Contas, partidas e lançamentos do cliente até uma data (para relatórios e conferências). */
export async function carregarBase(tx: Tx, clienteId: string, ate: Date): Promise<{ contas: ContaR[]; partidas: PartidaR[] }> {
  const plano = await tx.planoDeContas.findUnique({ where: { clienteId }, include: { contas: true } });
  if (!plano) return { contas: [], partidas: [] };
  const linhas = await tx.partida.findMany({
    where: { lancamento: { clienteId, excluidoEm: null, data: { lte: ate } } },
    include: { lancamento: { select: { id: true, numero: true, data: true, historico: true, origem: true } } },
  });
  return {
    contas: plano.contas.map((c) => ({ id: c.id, codigo: c.codigo, nome: c.nome, grupo: c.grupo, natureza: c.natureza, analitica: c.analitica, paiId: c.paiId, nivel: c.nivel, disponivel: c.disponivel })),
    partidas: linhas.map((p) => ({
      contaId: p.contaId, tipo: p.tipo, valor: p.valorCentavos, lancamentoId: p.lancamentoId, numero: p.lancamento.numero,
      data: p.lancamento.data, historico: p.lancamento.historico, origem: p.lancamento.origem, complemento: p.historicoComplementar,
    })),
  };
}

export const fimDoMes = (competencia: Date) => new Date(Date.UTC(competencia.getUTCFullYear(), competencia.getUTCMonth() + 1, 0));

/**
 * Contas de caixa e equivalentes com saldo ou movimento no mês que NÃO estão
 * ligadas a uma conta bancária: exigem justificativa para fechar (ex.: caixa
 * físico). As ligadas exigem a conciliação do mês fechada.
 */
export async function contasQuePedemJustificativa(tx: Tx, clienteId: string, competencia: Date) {
  const fim = fimDoMes(competencia);
  const { contas, partidas } = await carregarBase(tx, clienteId, fim);
  const s = calcularSaldos(contas, partidas, competencia, fim);
  // Só dispensa a justificativa quando a conta bancária já existia no mês (há conciliação a fechar).
  const ligadas = new Set((await tx.contaBancaria.findMany({ where: { clienteId, contaContabilId: { not: null }, dataSaldoInicial: { lte: fim } }, select: { contaContabilId: true } })).map((b) => b.contaContabilId!));
  return contas
    .filter((c) => c.disponivel && c.analitica && !ligadas.has(c.id))
    .map((c) => ({ conta: c, mov: s.get(c.id)! }))
    .filter(({ mov }) => mov.anterior !== 0n || mov.debitos !== 0n || mov.creditos !== 0n);
}

export interface PedidoTransicao {
  competencia: Date;
  para: SituacaoPeriodo;
  justificativa?: string;
  /** contaId -> texto, exigido ao fechar para as contas de caixa e equivalentes. */
  justificativasContas?: Record<string, string>;
}

export async function mudarSituacaoPeriodo(tx: Tx, autor: Autor, clienteId: string, e: PedidoTransicao) {
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  const periodo = await tx.periodoContabil.findUnique({ where: { clienteId_competencia: { clienteId, competencia: e.competencia } } });
  if (!periodo) throw new ErroDeNegocio("Este mês ainda não tem lançamentos.");
  const de = periodo.situacao;
  const para = e.para;
  const rotulo = rotuloCompetencia(periodo.competencia);
  const permitidas: Record<SituacaoPeriodo, SituacaoPeriodo[]> = {
    ABERTO: ["EM_CONFERENCIA"],
    EM_CONFERENCIA: ["ABERTO", "FECHADO"],
    FECHADO: ["ABERTO"],
  };
  if (!permitidas[de].includes(para)) throw new ErroDeNegocio(`Não é possível passar de ${NOME_SITUACAO_PERIODO[de].toLowerCase()} para ${NOME_SITUACAO_PERIODO[para].toLowerCase()}.`);
  if ((para === "FECHADO" || de === "FECHADO") && autor.perfil !== "CONTADOR") {
    throw new ErroDeNegocio("Só o contador responsável fecha e reabre períodos.");
  }

  if (para === "FECHADO") {
    const anteriorAberto = await tx.periodoContabil.findFirst({
      where: { clienteId, competencia: { lt: periodo.competencia }, situacao: { not: "FECHADO" } },
      orderBy: { competencia: "asc" },
    });
    if (anteriorAberto) throw new ErroDeNegocio(`Feche antes ${rotuloCompetencia(anteriorAberto.competencia)}: os meses são fechados em ordem.`);
    const { contas, partidas } = await carregarBase(tx, clienteId, fimDoMes(periodo.competencia));
    if (!balanceteFecha(contas, partidas, fimDoMes(periodo.competencia))) throw new ErroDeNegocio("O balancete não fecha. Corrija antes de fechar.");
    // Contas bancárias ligadas à contabilidade: a conciliação do mês precisa estar fechada.
    const bancos = await tx.contaBancaria.findMany({ where: { clienteId, contaContabilId: { not: null }, dataSaldoInicial: { lte: fimDoMes(periodo.competencia) } } });
    const semConciliar: string[] = [];
    for (const b of bancos) {
      const f = await tx.fechamentoConciliacao.findUnique({ where: { contaBancariaId_competencia: { contaBancariaId: b.id, competencia: periodo.competencia } } });
      if (!f?.fechado) semConciliar.push(b.nome);
    }
    if (semConciliar.length) throw new ErroDeNegocio(`Feche antes a conciliação bancária do mês de: ${semConciliar.join(", ")}.`);
    const pendentes = await contasQuePedemJustificativa(tx, clienteId, periodo.competencia);
    const faltando = pendentes.filter(({ conta }) => !(e.justificativasContas?.[conta.id] ?? "").trim());
    if (faltando.length) {
      throw new ErroDeNegocio(`Justifique o saldo de: ${faltando.map(({ conta }) => `${conta.codigo} ${conta.nome}`).join(", ")}. Até a conciliação bancária existir, cada conta de caixa precisa de uma justificativa (por exemplo, "saldo conferido com o extrato").`);
    }
    for (const { conta, mov } of pendentes) {
      await tx.justificativaFechamento.create({
        data: {
          escritorioId: autor.escritorioId, periodoId: periodo.id, usuarioId: autor.id,
          descricaoConta: `${conta.codigo} ${conta.nome} (saldo ${formatarReais(mov.final)})`,
          texto: e.justificativasContas![conta.id].trim(),
        },
      });
    }
  }

  if (de === "FECHADO") {
    if (!e.justificativa?.trim()) throw new ErroDeNegocio("Explique por que o período está sendo reaberto.");
    const posteriorFechado = await tx.periodoContabil.findFirst({
      where: { clienteId, competencia: { gt: periodo.competencia }, situacao: "FECHADO" },
      orderBy: { competencia: "desc" },
    });
    if (posteriorFechado) throw new ErroDeNegocio(`Reabra antes ${rotuloCompetencia(posteriorFechado.competencia)}: os meses são reabertos do mais recente para o mais antigo.`);
  }

  await tx.transicaoPeriodo.create({
    data: { escritorioId: autor.escritorioId, periodoId: periodo.id, de, para, justificativa: e.justificativa?.trim() || null, usuarioId: autor.id },
  });
  await tx.periodoContabil.update({ where: { id: periodo.id }, data: { situacao: para } });
  await registrarEvento(tx, autor, clienteId, "periodo.situacao", `Período ${rotulo}: ${NOME_SITUACAO_PERIODO[de].toLowerCase()} → ${NOME_SITUACAO_PERIODO[para].toLowerCase()}${e.justificativa ? ` (${e.justificativa.trim()})` : ""}`);
}

/**
 * Apuração do resultado do exercício: zera as contas de resultado do ano
 * contra uma conta do patrimônio líquido, em 31/12. Feita uma vez por ano;
 * para refazer, estorne a anterior.
 */
export async function apurarResultado(tx: Tx, autor: Autor, clienteId: string, ano: number, contaDestinoId: string) {
  const plano = await tx.planoDeContas.findUnique({ where: { clienteId }, include: { contas: true } });
  if (!plano) throw new ErroDeNegocio("Cliente sem plano de contas.");
  const destino = plano.contas.find((c) => c.id === contaDestinoId);
  if (!destino || !destino.analitica || destino.grupo !== "PATRIMONIO_LIQUIDO") throw new ErroDeNegocio("Escolha uma conta analítica do patrimônio líquido (ex.: lucros ou prejuízos acumulados).");
  const prefixo = `apuracao:${ano}:`;
  const ja = await tx.lancamentoContabil.findFirst({ where: { clienteId, origem: "ENCERRAMENTO", chaveOrigem: { startsWith: prefixo }, estornadoPor: null } });
  if (ja) throw new ErroDeNegocio(`O resultado de ${ano} já foi apurado (lançamento nº ${ja.numero}). Estorne-o para refazer.`);
  const fim = dataCivil(`${ano}-12-31`);
  const inicio = dataCivil(`${ano}-01-01`);
  const { contas, partidas } = await carregarBase(tx, clienteId, fim);
  // Saldo do ano nas contas de resultado (inclui estornos de apurações anteriores do mesmo ano).
  const s = calcularSaldos(contas, partidas, inicio, fim);
  const resultado = contas.filter((c) => c.analitica && GRUPOS_RESULTADO.includes(c.grupo)).map((c) => ({ c, mov: s.get(c.id)!.debitos - s.get(c.id)!.creditos })).filter((x) => x.mov !== 0n);
  if (!resultado.length) throw new ErroDeNegocio(`Não há saldo em contas de resultado em ${ano}.`);
  const liquido = resultado.reduce((t, x) => t + x.mov, 0n); // devedor positivo = prejuízo
  const valor = (v: bigint) => formatarReais(v < 0n ? -v : v).replace("R$ ", "");
  const partidasNovas = resultado.map((x) => ({ conta: x.c.codigo, tipo: (x.mov > 0n ? "CREDITO" : "DEBITO") as "CREDITO" | "DEBITO", valor: valor(x.mov) }));
  if (liquido !== 0n) partidasNovas.push({ conta: destino.codigo, tipo: liquido > 0n ? "DEBITO" : "CREDITO", valor: valor(liquido) });
  const lanc = await criarLancamento(tx, autor, clienteId, {
    data: `${ano}-12-31`,
    historico: `Apuração do resultado do exercício de ${ano}: ${liquido <= 0n ? "lucro" : "prejuízo"} de ${valor(liquido)}`,
    origem: "ENCERRAMENTO",
    partidas: partidasNovas,
  }, { chaveOrigem: prefixo + ((await tx.lancamentoContabil.count({ where: { clienteId, chaveOrigem: { startsWith: prefixo } } })) + 1) });
  await registrarEvento(tx, autor, clienteId, "resultado.apurado", `Resultado de ${ano} apurado (nº ${lanc.numero})`);
  return lanc;
}
