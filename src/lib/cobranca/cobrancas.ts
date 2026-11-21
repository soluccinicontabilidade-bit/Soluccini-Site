import { randomBytes } from "node:crypto";
import type { PerfilUsuario } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { ErroDeNegocio } from "@/lib/erros";
import { lerData, reaisParaCentavos } from "@/lib/br";
import { obterClienteVisivel, registrarEvento, valorVigente } from "@/lib/clientes";
import { gerarPixCopiaECola, validarChavePix } from "./pix";

interface Autor {
  id: string;
  escritorioId: string;
  perfil: PerfilUsuario;
}

const novoTxid = () => `SOL${randomBytes(9).toString("hex").toUpperCase()}`.slice(0, 25);

export async function salvarConfigPix(tx: Tx, autor: Autor, e: { chavePix: string; nomeRecebedor: string; cidadeRecebedor: string }) {
  if (autor.perfil !== "ADMINISTRADOR") throw new ErroDeNegocio("Só o administrador configura o recebimento.");
  const erro = validarChavePix(e.chavePix);
  if (erro) throw new ErroDeNegocio(erro);
  if (e.nomeRecebedor.trim().length < 3) throw new ErroDeNegocio("Informe o nome do recebedor, como aparece no banco.");
  if (e.cidadeRecebedor.trim().length < 2) throw new ErroDeNegocio("Informe a cidade do recebedor.");
  const dados = { chavePix: e.chavePix.trim(), nomeRecebedor: e.nomeRecebedor.trim().slice(0, 25), cidadeRecebedor: e.cidadeRecebedor.trim().slice(0, 15) };
  await tx.configEscritorio.upsert({ where: { escritorioId: autor.escritorioId }, create: { escritorioId: autor.escritorioId, ...dados }, update: dados });
}

async function pixDe(tx: Tx, escritorioId: string, valor: bigint, txid: string, descricao: string) {
  const cfg = await tx.configEscritorio.findUnique({ where: { escritorioId } });
  if (!cfg?.chavePix || !cfg.nomeRecebedor || !cfg.cidadeRecebedor) return null;
  return gerarPixCopiaECola({ chave: cfg.chavePix, nome: cfg.nomeRecebedor, cidade: cfg.cidadeRecebedor, valorCentavos: valor, txid, descricao });
}

/** Gera as cobranças de honorários do mês para todos os contratos vigentes (sem duplicar). */
export async function gerarCobrancasDoMes(tx: Tx, autor: Autor, competencia: Date) {
  if (autor.perfil !== "ADMINISTRADOR" && autor.perfil !== "CONTADOR") throw new ErroDeNegocio("Sem permissão.");
  const fim = new Date(Date.UTC(competencia.getUTCFullYear(), competencia.getUTCMonth() + 1, 0));
  const contratos = await tx.contrato.findMany({
    where: { excluidoEm: null, inicio: { lte: fim }, OR: [{ fim: null }, { fim: { gte: competencia } }], cliente: { situacao: { in: ["ATIVO", "EM_ENTRADA"] } } },
    include: { valores: true, cliente: { include: { pessoa: { select: { nome: true } } } } },
  });
  let criadas = 0;
  const semPix: string[] = [];
  for (const c of contratos) {
    if (await tx.cobranca.findUnique({ where: { contratoId_competencia: { contratoId: c.id, competencia } } })) continue;
    const v = valorVigente(c.valores, fim);
    if (!v || v.valorCentavos <= 0n) continue;
    const vencimento = new Date(Date.UTC(competencia.getUTCFullYear(), competencia.getUTCMonth(), c.diaVencimento));
    const txid = novoTxid();
    const mes = `${String(competencia.getUTCMonth() + 1).padStart(2, "0")}/${competencia.getUTCFullYear()}`;
    const pix = await pixDe(tx, autor.escritorioId, v.valorCentavos, txid, `Honorarios ${mes}`);
    if (!pix) semPix.push(c.cliente.pessoa.nome);
    await tx.cobranca.create({
      data: {
        escritorioId: autor.escritorioId, clienteId: c.clienteId, contratoId: c.id, competencia, descricao: `Honorários ${mes}`,
        valorCentavos: v.valorCentavos, vencimento, provedor: "pix-estatico", txid, pixCopiaECola: pix, criadoPorId: autor.id,
      },
    });
    criadas++;
  }
  return { criadas, semPix };
}

export async function criarCobrancaAvulsa(tx: Tx, autor: Autor, clienteId: string, e: { descricao: string; valor: string; vencimento: string }) {
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  let valor: bigint, venc: Date;
  try {
    valor = reaisParaCentavos(e.valor);
    venc = lerData(e.vencimento);
  } catch {
    throw new ErroDeNegocio("Confira valor e vencimento.");
  }
  if (valor <= 0n) throw new ErroDeNegocio("O valor precisa ser maior que zero.");
  if (e.descricao.trim().length < 3) throw new ErroDeNegocio("Descreva a cobrança.");
  const txid = novoTxid();
  return tx.cobranca.create({
    data: {
      escritorioId: autor.escritorioId, clienteId, competencia: new Date(Date.UTC(venc.getUTCFullYear(), venc.getUTCMonth(), 1)), descricao: e.descricao.trim(),
      valorCentavos: valor, vencimento: venc, provedor: "pix-estatico", txid, pixCopiaECola: await pixDe(tx, autor.escritorioId, valor, txid, e.descricao), criadoPorId: autor.id,
    },
  });
}

export async function registrarPagamento(tx: Tx, autor: Autor, cobrancaId: string, e: { data: string; valor: string }) {
  const c = await tx.cobranca.findUnique({ where: { id: cobrancaId } });
  if (!c || !(await obterClienteVisivel(tx, autor, c.clienteId))) throw new ErroDeNegocio("Cobrança não encontrada.");
  if (c.situacao !== "PENDENTE") throw new ErroDeNegocio("Esta cobrança não está pendente.");
  let valor: bigint, dia: Date;
  try {
    valor = e.valor ? reaisParaCentavos(e.valor) : c.valorCentavos;
    dia = lerData(e.data);
  } catch {
    throw new ErroDeNegocio("Confira data e valor.");
  }
  await tx.cobranca.update({ where: { id: c.id }, data: { situacao: "PAGA", pagaEm: dia, valorPagoCentavos: valor, baixaPorId: autor.id } });
  await registrarEvento(tx, autor, c.clienteId, "cobranca.paga", `Honorário recebido: ${c.descricao}`);
}

export async function cancelarCobranca(tx: Tx, autor: Autor, cobrancaId: string, motivo: string) {
  const c = await tx.cobranca.findUnique({ where: { id: cobrancaId } });
  if (!c || !(await obterClienteVisivel(tx, autor, c.clienteId))) throw new ErroDeNegocio("Cobrança não encontrada.");
  if (c.situacao !== "PENDENTE") throw new ErroDeNegocio("Só cobranças pendentes podem ser canceladas.");
  if (!motivo.trim()) throw new ErroDeNegocio("Informe o motivo.");
  await tx.cobranca.update({ where: { id: c.id }, data: { situacao: "CANCELADA", canceladaEm: new Date(), motivoCancelamento: motivo.trim() } });
}
