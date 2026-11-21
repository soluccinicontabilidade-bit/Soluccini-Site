// Leitura de extratos OFX (versões 1.x em SGML e 2.x em XML), sem dependências.
import { randomUUID } from "node:crypto";
import type { Tx } from "@/lib/db";
import { ErroDeNegocio } from "@/lib/erros";
import { sha256 } from "@/lib/cripto";
import { gravarArquivo } from "@/lib/armazenamento";
import { obterClienteVisivel, registrarEvento } from "@/lib/clientes";
import type { Autor } from "./financeiro";

export interface TransacaoOfx {
  data: Date;
  valorCentavos: bigint;
  fitid: string | null;
  tipo: string | null;
  descricao: string;
}

export interface ExtratoOfx {
  bancoId: string | null;
  conta: string | null;
  inicio: Date | null;
  fim: Date | null;
  saldo: bigint | null;
  dataSaldo: Date | null;
  transacoes: TransacaoOfx[];
}

function decodificar(buf: Buffer): string {
  const cabecalho = buf.subarray(0, 600).toString("latin1");
  const utf8 = /CHARSET:\s*UTF-?8|encoding="utf-8"/i.test(cabecalho);
  let t = buf.toString(utf8 ? "utf8" : "latin1");
  if (!utf8 && /Ã[§£©¡³ºµ]/.test(t)) t = buf.toString("utf8"); // arquivo diz latin1 mas é UTF-8
  return t;
}

const tag = (bloco: string, nome: string): string | null => {
  const m = bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, "i"));
  return m ? m[1].trim() : null;
};

function dataOfx(s: string | null): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Valor OFX ("-1234.56", "1234,56", "+10") em centavos. */
export function valorOfx(s: string): bigint {
  const limpo = s.trim().replace(/^\+/, "");
  const m = limpo.match(/^(-?)(\d+)(?:[.,](\d{1,2}))?$/);
  if (!m) throw new ErroDeNegocio(`Valor inválido no extrato: "${s}"`);
  const c = BigInt(m[2]) * 100n + BigInt(((m[3] ?? "") + "00").slice(0, 2));
  return m[1] ? -c : c;
}

const entidades = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

export function lerOfx(conteudo: Buffer): ExtratoOfx {
  const texto = decodificar(conteudo);
  if (!/<OFX>/i.test(texto)) throw new ErroDeNegocio("O arquivo não parece ser um OFX. Exporte o extrato no formato OFX (Money) no site do banco.");
  const blocos = texto.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
  const transacoes: TransacaoOfx[] = [];
  for (const b of blocos) {
    const d = dataOfx(tag(b, "DTPOSTED"));
    const v = tag(b, "TRNAMT");
    if (!d || !v) continue;
    const valor = valorOfx(v);
    if (valor === 0n) continue;
    const descricao = entidades([tag(b, "NAME"), tag(b, "MEMO")].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(" · ")) || "(sem descrição)";
    transacoes.push({ data: d, valorCentavos: valor, fitid: tag(b, "FITID"), tipo: tag(b, "TRNTYPE"), descricao: descricao.slice(0, 300) });
  }
  const ledger = texto.match(/<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>)/i)?.[1] ?? "";
  const saldo = tag(ledger, "BALAMT");
  return {
    bancoId: tag(texto, "BANKID"),
    conta: tag(texto, "ACCTID"),
    inicio: dataOfx(tag(texto, "DTSTART")),
    fim: dataOfx(tag(texto, "DTEND")),
    saldo: saldo ? valorOfx(saldo) : null,
    dataSaldo: dataOfx(tag(ledger, "DTASOF")),
    transacoes,
  };
}

/**
 * Impressão digital de cada transação. Com FITID (identificador do banco),
 * usa conta + FITID. Sem FITID, usa conta + data + valor + descrição + a
 * ordem entre transações idênticas no mesmo dia (para não juntar duas
 * tarifas iguais no mesmo dia).
 */
export function impressoes(contaId: string, ts: TransacaoOfx[]): string[] {
  const vistos = new Map<string, number>();
  return ts.map((t) => {
    if (t.fitid) return sha256(`${contaId}|fitid|${t.fitid}`);
    const base = `${contaId}|${t.data.toISOString().slice(0, 10)}|${t.valorCentavos}|${t.descricao.toLowerCase()}`;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return sha256(`${base}|${n}`);
  });
}

export async function importarExtrato(tx: Tx, autor: Autor, clienteId: string, contaId: string, arquivo: { nome: string; conteudo: Buffer }) {
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  const conta = await tx.contaBancaria.findFirst({ where: { id: contaId, clienteId } });
  if (!conta) throw new ErroDeNegocio("Conta bancária não encontrada.");
  if (!/\.ofx$/i.test(arquivo.nome)) throw new ErroDeNegocio("Envie o extrato em OFX. PDF pode ser guardado como documento do cliente.");
  if (arquivo.conteudo.length > 10 * 1024 * 1024) throw new ErroDeNegocio("O arquivo passa de 10 MB.");
  const hash = sha256(arquivo.conteudo);
  const repetido = await tx.extratoImportado.findFirst({ where: { contaBancariaId: contaId, sha256: hash } });
  if (repetido) throw new ErroDeNegocio("Este mesmo arquivo já foi importado nesta conta.");
  const ofx = lerOfx(arquivo.conteudo);
  if (!ofx.transacoes.length) throw new ErroDeNegocio("O extrato não tem transações.");
  if (conta.numero && ofx.conta && !somenteDigitosIguais(conta.numero, ofx.conta)) {
    throw new ErroDeNegocio(`O extrato é da conta ${ofx.conta}, mas a conta escolhida é ${conta.numero}. Confira a conta.`);
  }
  const anteriores = ofx.transacoes.filter((t) => t.data < conta.dataSaldoInicial).length;
  const chave = `${autor.escritorioId}/extratos/${randomUUID()}`;
  await gravarArquivo(chave, arquivo.conteudo);
  const extrato = await tx.extratoImportado.create({
    data: {
      escritorioId: autor.escritorioId, contaBancariaId: contaId, chaveArquivo: chave, nomeOriginal: arquivo.nome.slice(0, 200), sha256: hash,
      dataInicio: ofx.inicio, dataFim: ofx.fim, saldoFinalCentavos: ofx.saldo, dataSaldo: ofx.dataSaldo ?? ofx.fim, novas: 0, repetidas: 0, criadoPorId: autor.id,
    },
  });
  const validas = ofx.transacoes.filter((t) => t.data >= conta.dataSaldoInicial);
  const digitais = impressoes(contaId, validas);
  const existentes = new Set((await tx.transacaoBancaria.findMany({ where: { contaBancariaId: contaId, impressaoDigital: { in: digitais } }, select: { impressaoDigital: true } })).map((t) => t.impressaoDigital));
  let novas = 0;
  for (const [i, t] of validas.entries()) {
    if (existentes.has(digitais[i])) continue;
    await tx.transacaoBancaria.create({
      data: {
        escritorioId: autor.escritorioId, clienteId, contaBancariaId: contaId, extratoId: extrato.id, data: t.data,
        valorCentavos: t.valorCentavos, descricao: t.descricao, tipoOfx: t.tipo, fitid: t.fitid, impressaoDigital: digitais[i],
      },
    });
    existentes.add(digitais[i]);
    novas++;
  }
  const repetidas = validas.length - novas;
  await tx.extratoImportado.update({ where: { id: extrato.id }, data: { novas, repetidas } });
  await registrarEvento(tx, autor, clienteId, "financeiro.extrato", `Extrato importado em ${conta.nome}: ${novas} transação(ões) nova(s), ${repetidas} repetida(s)`);
  return { extratoId: extrato.id, novas, repetidas, anteriores };
}

const somenteDigitosIguais = (a: string, b: string) => {
  const x = a.replace(/\D/g, "").replace(/^0+/, "");
  const y = b.replace(/\D/g, "").replace(/^0+/, "");
  return !x || !y || x === y || x.endsWith(y) || y.endsWith(x) || x.slice(0, -1) === y || y.slice(0, -1) === x;
};
