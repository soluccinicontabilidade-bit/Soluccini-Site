// Ligação do financeiro com a contabilidade.
// Competência: a emissão do título provisiona (despesa contra fornecedores /
// clientes contra receita) e a baixa liquida (fornecedores contra banco).
// Caixa: só a baixa gera lançamento (despesa ou receita contra banco).
// Transferências: banco contra banco. Tudo idempotente por chave de origem;
// se o título muda depois de contabilizado, o lançamento antigo é estornado
// e um novo é criado.
import type { TipoPartida } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { ErroDeNegocio } from "@/lib/erros";
import { formatarReais, isoData } from "@/lib/br";
import { obterClienteVisivel, registrarEvento } from "@/lib/clientes";
import { criarLancamento, estornarLancamento, rotuloCompetencia } from "@/lib/contabil/lancamentos";
import type { Autor } from "./financeiro";

interface PartidaDesejada {
  contaId: string;
  tipo: TipoPartida;
  valor: bigint;
}

interface LancamentoDesejado {
  chave: string; // base, sem o sufixo de versão
  data: Date;
  historico: string;
  partidas: PartidaDesejada[];
}

/** Divide `total` proporcionalmente aos pesos, sem perder centavos. */
export function ratear(total: bigint, pesos: bigint[]): bigint[] {
  const soma = pesos.reduce((a, b) => a + b, 0n);
  if (soma === 0n) return pesos.map(() => 0n);
  const partes = pesos.map((p) => (total * p) / soma);
  let resto = total - partes.reduce((a, b) => a + b, 0n);
  const ordem = pesos.map((p, i) => ({ i, r: (total * p) % soma })).sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : 0));
  for (const { i } of ordem) {
    if (resto <= 0n) break;
    partes[i] += 1n;
    resto -= 1n;
  }
  return partes;
}

/** Agrupa partidas iguais (mesma conta e lado) e remove zeros. */
function consolidar(ps: PartidaDesejada[]): PartidaDesejada[] {
  const m = new Map<string, PartidaDesejada>();
  for (const p of ps) {
    if (p.valor === 0n) continue;
    const k = `${p.contaId}|${p.tipo}`;
    const atual = m.get(k);
    if (atual) atual.valor += p.valor;
    else m.set(k, { ...p });
  }
  return [...m.values()];
}

const assinatura = (ps: { contaId: string; tipo: TipoPartida; valor: bigint }[]) =>
  ps.map((p) => `${p.contaId}|${p.tipo}|${p.valor}`).sort().join(";");

export interface ResultadoSincronizacao {
  criados: number;
  estornados: number;
  pendencias: string[];
}

export async function sincronizarContabil(tx: Tx, autor: Autor, clienteId: string, competencia: Date): Promise<ResultadoSincronizacao> {
  const cliente = await obterClienteVisivel(tx, autor, clienteId);
  if (!cliente) throw new ErroDeNegocio("Cliente não encontrado.");
  const fim = new Date(Date.UTC(competencia.getUTCFullYear(), competencia.getUTCMonth() + 1, 0));
  const pendencias: string[] = [];
  const cfg = await tx.configFinanceira.findUnique({ where: { clienteId } });
  const competenciaRegime = cliente.regimeContabil === "COMPETENCIA";
  const contasPorId = new Map((await tx.contaContabil.findMany({ where: { plano: { clienteId } } })).map((c) => [c.id, c]));
  const exigir = (id: string | null | undefined, nome: string): string | null => {
    if (!id || !contasPorId.get(id)?.analitica) {
      pendencias.push(`Configure a conta contábil de ${nome}.`);
      return null;
    }
    return id;
  };

  const desejados: LancamentoDesejado[] = [];
  const contaBanco = new Map((await tx.contaBancaria.findMany({ where: { clienteId } })).map((b) => [b.id, b]));
  const bancoContabil = (id: string) => {
    const b = contaBanco.get(id)!;
    if (!b.contaContabilId) {
      pendencias.push(`Ligue a conta bancária "${b.nome}" a uma conta contábil de caixa e equivalentes.`);
      return null;
    }
    return b.contaContabilId;
  };
  const categoriaContabil = new Map((await tx.categoriaFinanceira.findMany({ where: { clienteId } })).map((c) => [c.id, c]));
  const contaDaCategoria = (catId: string) => {
    const c = categoriaContabil.get(catId)!;
    if (!c.contaContabilId) {
      pendencias.push(`Ligue a categoria "${c.nome}" a uma conta contábil.`);
      return null;
    }
    return c.contaContabilId;
  };

  // Emissões (regime de competência)
  if (competenciaRegime) {
    const titulos = await tx.tituloFinanceiro.findMany({ where: { clienteId, canceladoEm: null, competencia: { gte: competencia, lte: fim } }, include: { rateios: true, favorecido: true } });
    for (const t of titulos) {
      const ponte = exigir(t.tipo === "PAGAR" ? cfg?.contaFornecedoresId : cfg?.contaClientesId, t.tipo === "PAGAR" ? "fornecedores" : "clientes");
      const contas = t.rateios.map((r) => ({ conta: contaDaCategoria(r.categoriaId), valor: r.valorCentavos }));
      if (!ponte || contas.some((c) => !c.conta)) continue;
      const lado: TipoPartida = t.tipo === "PAGAR" ? "DEBITO" : "CREDITO";
      const oposto: TipoPartida = lado === "DEBITO" ? "CREDITO" : "DEBITO";
      desejados.push({
        chave: `fin:emissao:${t.id}`,
        data: t.competencia,
        historico: `${t.tipo === "PAGAR" ? "Conta a pagar" : "Conta a receber"}: ${t.descricao}${t.favorecido ? ` (${t.favorecido.nome})` : ""}`,
        partidas: consolidar([...contas.map((c) => ({ contaId: c.conta!, tipo: lado, valor: c.valor })), { contaId: ponte, tipo: oposto, valor: t.valorCentavos }]),
      });
    }
  }

  // Baixas
  const baixas = await tx.parcela.findMany({
    where: { clienteId, situacao: "BAIXADA", dataBaixa: { gte: competencia, lte: fim } },
    include: { titulo: { include: { rateios: true, favorecido: true } } },
  });
  for (const p of baixas) {
    const t = p.titulo;
    const banco = bancoContabil(p.contaBaixaId!);
    if (!banco) continue;
    const pagar = t.tipo === "PAGAR";
    const acrescimo = p.jurosCentavos + p.multaCentavos;
    const partidas: PartidaDesejada[] = [];
    if (competenciaRegime) {
      const ponte = exigir(pagar ? cfg?.contaFornecedoresId : cfg?.contaClientesId, pagar ? "fornecedores" : "clientes");
      if (!ponte) continue;
      partidas.push({ contaId: ponte, tipo: pagar ? "DEBITO" : "CREDITO", valor: p.valorCentavos });
    } else {
      const valores = ratear(p.valorCentavos, t.rateios.map((r) => r.valorCentavos));
      const contas = t.rateios.map((r) => contaDaCategoria(r.categoriaId));
      if (contas.some((c) => !c)) continue;
      contas.forEach((c, i) => partidas.push({ contaId: c!, tipo: pagar ? "DEBITO" : "CREDITO", valor: valores[i] }));
    }
    if (acrescimo > 0n) {
      const c = exigir(pagar ? cfg?.contaJurosPagosId : cfg?.contaJurosRecebidosId, pagar ? "juros pagos" : "juros recebidos");
      if (!c) continue;
      partidas.push({ contaId: c, tipo: pagar ? "DEBITO" : "CREDITO", valor: acrescimo });
    }
    if (p.descontoCentavos > 0n) {
      const c = exigir(pagar ? cfg?.contaDescontosObtidosId : cfg?.contaDescontosConcedidosId, pagar ? "descontos obtidos" : "descontos concedidos");
      if (!c) continue;
      partidas.push({ contaId: c, tipo: pagar ? "CREDITO" : "DEBITO", valor: p.descontoCentavos });
    }
    partidas.push({ contaId: banco, tipo: pagar ? "CREDITO" : "DEBITO", valor: p.valorBaixaCentavos! });
    desejados.push({
      chave: `fin:baixa:${p.id}`,
      data: p.dataBaixa!,
      historico: `${pagar ? "Pagamento" : "Recebimento"}: ${t.descricao}${p.total > 1 ? ` (parcela ${p.numero}/${p.total})` : ""}${t.favorecido ? ` · ${t.favorecido.nome}` : ""}`,
      partidas: consolidar(partidas),
    });
  }

  // Transferências
  const transf = await tx.transferencia.findMany({ where: { clienteId, canceladaEm: null, data: { gte: competencia, lte: fim } } });
  for (const t of transf) {
    const o = bancoContabil(t.origemId);
    const d = bancoContabil(t.destinoId);
    if (!o || !d) continue;
    desejados.push({ chave: `fin:transf:${t.id}`, data: t.data, historico: t.descricao, partidas: [{ contaId: d, tipo: "DEBITO", valor: t.valorCentavos }, { contaId: o, tipo: "CREDITO", valor: t.valorCentavos }] });
  }

  // Lançamentos do financeiro já existentes no mês (ativos = não estornados)
  const existentes = await tx.lancamentoContabil.findMany({
    where: { clienteId, origem: "FINANCEIRO", excluidoEm: null, estornadoPor: null, data: { gte: competencia, lte: fim } },
    include: { partidas: true },
  });
  const porBase = new Map(existentes.map((l) => [l.chaveOrigem!.replace(/:\d+$/, ""), l]));
  const periodo = await tx.periodoContabil.findUnique({ where: { clienteId_competencia: { clienteId, competencia } } });
  if (periodo && periodo.situacao !== "ABERTO") {
    throw new ErroDeNegocio(`O período contábil ${rotuloCompetencia(competencia)} não está aberto. Reabra-o para contabilizar o financeiro.`);
  }
  let criados = 0;
  let estornados = 0;
  const desejadasBase = new Set(desejados.map((d) => d.chave));
  for (const d of desejados) {
    const atual = porBase.get(d.chave);
    if (atual && assinatura(atual.partidas.map((p) => ({ contaId: p.contaId, tipo: p.tipo, valor: p.valorCentavos }))) === assinatura(d.partidas) && isoData(atual.data) === isoData(d.data)) continue;
    if (atual) {
      await estornarLancamento(tx, autor, clienteId, atual.id, isoData(atual.data), "Título alterado no financeiro");
      estornados++;
    }
    const versao = (await tx.lancamentoContabil.count({ where: { clienteId, chaveOrigem: { startsWith: `${d.chave}:` } } })) + 1;
    const contas = d.partidas.map((p) => contasPorId.get(p.contaId)!);
    await criarLancamento(tx, autor, clienteId, {
      data: isoData(d.data), historico: d.historico.slice(0, 500), origem: "FINANCEIRO",
      partidas: d.partidas.map((p, i) => ({ conta: contas[i].codigo, tipo: p.tipo, valor: formatarReais(p.valor).replace("R$ ", "") })),
    }, { chaveOrigem: `${d.chave}:${versao}` });
    criados++;
  }
  // O que foi contabilizado e não existe mais (título cancelado, baixa estornada): estorna.
  for (const [base, l] of porBase) {
    // Com configuração faltando, parte do esperado não foi calculada: não estorna nada por ausência.
    if (pendencias.length) break;
    if (desejadasBase.has(base)) continue;
    await estornarLancamento(tx, autor, clienteId, l.id, isoData(l.data), "Movimento cancelado ou estornado no financeiro");
    estornados++;
  }
  if (criados || estornados) await registrarEvento(tx, autor, clienteId, "financeiro.contabil", `Financeiro de ${rotuloCompetencia(competencia)} contabilizado: ${criados} lançamento(s) novo(s), ${estornados} estorno(s)`);
  return { criados, estornados, pendencias: [...new Set(pendencias)] };
}
