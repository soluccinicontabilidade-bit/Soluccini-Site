// Aceite eletrônico de documentos pelo portal: assinatura eletrônica simples
// (o cliente, logado com senha e código do celular, declara que leu e aceita).
// Guarda quem, quando, de onde e o hash SHA-256 exato do arquivo aceito.
// Para assinatura com certificado ICP-Brasil, é preciso integrar um provedor.
import type { PerfilUsuario } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { ErroDeNegocio } from "@/lib/erros";
import { obterClienteVisivel, registrarEvento } from "@/lib/clientes";

interface Autor {
  id: string;
  escritorioId: string;
  perfil: PerfilUsuario;
}

export async function solicitarAceite(tx: Tx, autor: Autor, clienteId: string, documentoId: string, mensagem?: string) {
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  const doc = await tx.documento.findFirst({ where: { id: documentoId, clienteId, excluidoEm: null }, include: { versoes: { orderBy: { versao: "desc" }, take: 1 } } });
  if (!doc?.versoes[0]) throw new ErroDeNegocio("Documento não encontrado.");
  if (!(await tx.acessoCliente.count({ where: { clienteId, usuario: { ativo: true } } }))) throw new ErroDeNegocio("O cliente ainda não tem acesso ao portal. Crie o acesso antes de pedir o aceite.");
  const s = await tx.solicitacaoAceite.create({ data: { escritorioId: autor.escritorioId, clienteId, documentoId: doc.id, versaoId: doc.versoes[0].id, mensagem: mensagem?.trim() || null, solicitadoPorId: autor.id } });
  await registrarEvento(tx, autor, clienteId, "aceite.solicitado", `Aceite solicitado: ${doc.titulo}`);
  return s;
}

/** Aceite pelo usuário do portal (cliente). */
export async function aceitar(tx: Tx, usuario: Autor & { nome: string; email: string }, solicitacaoId: string, ip: string | null, userAgent: string | null) {
  const s = await tx.solicitacaoAceite.findUnique({ where: { id: solicitacaoId } });
  if (!s || s.canceladaEm) throw new ErroDeNegocio("Pedido de aceite não encontrado.");
  if (!(await tx.acessoCliente.findFirst({ where: { usuarioId: usuario.id, clienteId: s.clienteId } }))) throw new ErroDeNegocio("Sem acesso a este cliente.");
  if (await tx.aceiteDocumento.findFirst({ where: { solicitacaoId: s.id, usuarioId: usuario.id } })) throw new ErroDeNegocio("Você já aceitou este documento.");
  const versao = await tx.versaoDocumento.findUniqueOrThrow({ where: { id: s.versaoId }, include: { documento: true } });
  await tx.aceiteDocumento.create({
    data: { escritorioId: usuario.escritorioId, solicitacaoId: s.id, usuarioId: usuario.id, nomeUsuario: usuario.nome, emailUsuario: usuario.email, sha256Documento: versao.sha256, ip, userAgent: userAgent?.slice(0, 300) ?? null },
  });
  await tx.eventoCliente.create({ data: { escritorioId: usuario.escritorioId, clienteId: s.clienteId, tipo: "aceite.feito", resumo: `${usuario.nome} aceitou o documento ${versao.documento.titulo}`, usuarioId: usuario.id } });
}
