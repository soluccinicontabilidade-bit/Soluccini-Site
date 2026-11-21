import { randomUUID } from "node:crypto";
import type { Tx } from "@/lib/db";
import type { PerfilUsuario } from "@prisma/client";
import { sha256 } from "@/lib/cripto";
import { gravarArquivo } from "@/lib/armazenamento";
import { lerData } from "@/lib/br";
import { ErroDeNegocio, obterClienteVisivel, registrarEvento } from "@/lib/clientes";

export const TAMANHO_MAXIMO = 20 * 1024 * 1024;

// Extensão -> tipos aceitos. O conteúdo é conferido pela assinatura do arquivo quando possível.
const PERMITIDOS: Record<string, string[]> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  csv: ["text/csv", "application/vnd.ms-excel", "text/plain"],
  xml: ["application/xml", "text/xml"],
  ofx: ["application/x-ofx", "application/octet-stream", "text/plain"],
  txt: ["text/plain"],
};

const ASSINATURAS: Record<string, number[]> = {
  pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
  png: [0x89, 0x50, 0x4e, 0x47],
  jpg: [0xff, 0xd8, 0xff],
  jpeg: [0xff, 0xd8, 0xff],
  xlsx: [0x50, 0x4b, 0x03, 0x04], // zip
  docx: [0x50, 0x4b, 0x03, 0x04],
};

export const EXTENSOES_ACEITAS = Object.keys(PERMITIDOS).map((e) => `.${e}`).join(",");

export function validarArquivo(nome: string, tipo: string, conteudo: Buffer): string | null {
  if (conteudo.length === 0) return "O arquivo está vazio.";
  if (conteudo.length > TAMANHO_MAXIMO) return "O arquivo passa de 20 MB.";
  const ext = nome.toLowerCase().split(".").pop() ?? "";
  if (!PERMITIDOS[ext]) return `Formato não aceito. Envie ${Object.keys(PERMITIDOS).join(", ").toUpperCase()}.`;
  if (tipo && !PERMITIDOS[ext].includes(tipo) && tipo !== "application/octet-stream") return "O tipo do arquivo não corresponde à extensão.";
  const assinatura = ASSINATURAS[ext];
  if (assinatura && !assinatura.every((b, i) => conteudo[i] === b)) return "O conteúdo do arquivo não corresponde à extensão.";
  return null;
}

const nomeSeguro = (n: string) => n.replace(/[\\/\0\r\n"]/g, "_").slice(0, 200);

interface Autor {
  id: string;
  escritorioId: string;
  perfil: PerfilUsuario;
}

export interface ArquivoRecebido {
  nome: string;
  tipo: string;
  conteudo: Buffer;
}

async function gravarVersao(tx: Tx, autor: Autor, documentoId: string, versao: number, arq: ArquivoRecebido) {
  const erro = validarArquivo(arq.nome, arq.tipo, arq.conteudo);
  if (erro) throw new ErroDeNegocio(erro);
  const chave = `${autor.escritorioId}/documentos/${documentoId}/${randomUUID()}`;
  await gravarArquivo(chave, arq.conteudo);
  return tx.versaoDocumento.create({
    data: {
      escritorioId: autor.escritorioId,
      documentoId,
      versao,
      chaveArquivo: chave,
      nomeOriginal: nomeSeguro(arq.nome),
      tipoMime: arq.tipo || "application/octet-stream",
      tamanhoBytes: BigInt(arq.conteudo.length),
      sha256: sha256(arq.conteudo),
      enviadoPorId: autor.id,
    },
  });
}

export async function enviarDocumento(
  tx: Tx,
  autor: Autor,
  clienteId: string,
  e: { categoriaId: string; titulo: string; competencia?: string; validoAte?: string; arquivo: ArquivoRecebido },
) {
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  const categoria = await tx.categoriaDocumento.findUnique({ where: { id: e.categoriaId } });
  if (!categoria) throw new ErroDeNegocio("Escolha a categoria do documento.");
  const titulo = e.titulo.trim() || categoria.nome;
  let competencia: Date | null = null;
  let validoAte: Date | null = null;
  try {
    if (e.competencia) competencia = lerData(/^\d{4}-\d{2}$/.test(e.competencia) ? `${e.competencia}-01` : e.competencia);
    if (e.validoAte) validoAte = lerData(e.validoAte);
  } catch {
    throw new ErroDeNegocio("Data inválida.");
  }
  if (competencia && competencia.getUTCDate() !== 1) throw new ErroDeNegocio("A competência é um mês (mm/aaaa).");
  if (categoria.temValidade && !validoAte) throw new ErroDeNegocio(`Informe a validade: a categoria ${categoria.nome} vence.`);

  // Mesmo arquivo já enviado para este cliente? Avisa em vez de duplicar.
  const hash = sha256(e.arquivo.conteudo);
  const repetido = await tx.versaoDocumento.findFirst({
    where: { sha256: hash, documento: { clienteId, excluidoEm: null } },
    include: { documento: true },
  });
  if (repetido) throw new ErroDeNegocio(`Este arquivo já foi enviado como "${repetido.documento.titulo}".`);

  const doc = await tx.documento.create({
    data: { escritorioId: autor.escritorioId, clienteId, categoriaId: categoria.id, titulo, competencia, validoAte },
  });
  await gravarVersao(tx, autor, doc.id, 1, e.arquivo);
  await registrarEvento(tx, autor, clienteId, "documento.enviado", `Documento enviado: ${titulo}`);
  return doc;
}

export async function enviarNovaVersao(tx: Tx, autor: Autor, clienteId: string, documentoId: string, arquivo: ArquivoRecebido, validoAte?: string) {
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  const doc = await tx.documento.findFirst({
    where: { id: documentoId, clienteId, excluidoEm: null },
    include: { versoes: { orderBy: { versao: "desc" }, take: 1 } },
  });
  if (!doc) throw new ErroDeNegocio("Documento não encontrado.");
  const proxima = (doc.versoes[0]?.versao ?? 0) + 1;
  await gravarVersao(tx, autor, doc.id, proxima, arquivo);
  if (validoAte) await tx.documento.update({ where: { id: doc.id }, data: { validoAte: lerData(validoAte) } });
  await registrarEvento(tx, autor, clienteId, "documento.versao", `Nova versão (${proxima}) de: ${doc.titulo}`);
}

export async function excluirDocumento(tx: Tx, autor: Autor, clienteId: string, documentoId: string) {
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  const doc = await tx.documento.findFirst({ where: { id: documentoId, clienteId, excluidoEm: null } });
  if (!doc) throw new ErroDeNegocio("Documento não encontrado.");
  // Exclusão lógica: o arquivo continua guardado para cumprir os prazos legais de guarda.
  await tx.documento.update({ where: { id: doc.id }, data: { excluidoEm: new Date() } });
  await registrarEvento(tx, autor, clienteId, "documento.excluido", `Documento retirado da lista: ${doc.titulo}`);
}

export const CATEGORIAS_PADRAO: { nome: string; temValidade: boolean; avisoDiasAntes?: number }[] = [
  { nome: "Contrato social e alterações", temValidade: false },
  { nome: "Cartão CNPJ", temValidade: false },
  { nome: "Documento pessoal", temValidade: false },
  { nome: "Certidão negativa federal", temValidade: true, avisoDiasAntes: 15 },
  { nome: "Certidão negativa estadual", temValidade: true, avisoDiasAntes: 15 },
  { nome: "Certidão negativa municipal", temValidade: true, avisoDiasAntes: 15 },
  { nome: "Certificado digital", temValidade: true, avisoDiasAntes: 30 },
  { nome: "Alvará", temValidade: true, avisoDiasAntes: 30 },
  { nome: "Procuração", temValidade: true, avisoDiasAntes: 30 },
  { nome: "Outros", temValidade: false },
];
