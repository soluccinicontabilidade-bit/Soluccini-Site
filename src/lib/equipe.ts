import type { PerfilUsuario } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { ehViolacaoUnica } from "@/lib/db";
import { ErroDeNegocio } from "@/lib/clientes";
import { gerarHashSenha, gerarSenhaTemporaria, problemaNaSenha, senhaConfere } from "@/lib/auth/senha";

interface Autor {
  id: string;
  escritorioId: string;
}

const PERFIS: PerfilUsuario[] = ["ADMINISTRADOR", "CONTADOR", "ANALISTA_BPO", "ANALISTA_IRPF", "CLIENTE_LEITOR", "CLIENTE_APROVADOR"];

/** Cria o usuário com senha temporária, mostrada uma única vez a quem cadastrou. */
export async function criarUsuario(tx: Tx, autor: Autor, e: { nome: string; email: string; perfil: string }) {
  const email = e.email.trim().toLowerCase();
  if (e.nome.trim().length < 2) throw new ErroDeNegocio("Informe o nome.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroDeNegocio("E-mail inválido.");
  if (!PERFIS.includes(e.perfil as PerfilUsuario)) throw new ErroDeNegocio("Escolha o perfil.");
  const senha = gerarSenhaTemporaria();
  try {
    await tx.usuario.create({
      data: { escritorioId: autor.escritorioId, nome: e.nome.trim(), email, perfil: e.perfil as PerfilUsuario, senhaHash: await gerarHashSenha(senha) },
    });
  } catch (err) {
    if (ehViolacaoUnica(err)) throw new ErroDeNegocio("Já existe um usuário com este e-mail.");
    throw err;
  }
  return { senhaTemporaria: senha };
}

async function usuarioDoEscritorio(tx: Tx, id: string) {
  const u = await tx.usuario.findUnique({ where: { id } });
  if (!u) throw new ErroDeNegocio("Usuário não encontrado.");
  return u;
}

async function restaraAdministrador(tx: Tx, excetoId: string) {
  return (await tx.usuario.count({ where: { perfil: "ADMINISTRADOR", ativo: true, id: { not: excetoId } } })) > 0;
}

export async function alterarUsuario(tx: Tx, autor: Autor, id: string, e: { perfil: string; ativo: boolean }) {
  const u = await usuarioDoEscritorio(tx, id);
  if (!PERFIS.includes(e.perfil as PerfilUsuario)) throw new ErroDeNegocio("Perfil inválido.");
  const deixaDeSerAdmin = u.perfil === "ADMINISTRADOR" && (e.perfil !== "ADMINISTRADOR" || !e.ativo);
  if (deixaDeSerAdmin && !(await restaraAdministrador(tx, id))) throw new ErroDeNegocio("O escritório precisa de pelo menos um administrador ativo.");
  await tx.usuario.update({ where: { id }, data: { perfil: e.perfil as PerfilUsuario, ativo: e.ativo } });
  if (!e.ativo) await tx.sessao.updateMany({ where: { usuarioId: id, revogadaEm: null }, data: { revogadaEm: new Date() } });
}

/** Administrador gera nova senha temporária e zera a verificação em duas etapas (ex.: celular perdido). */
export async function redefinirAcesso(tx: Tx, autor: Autor, id: string) {
  await usuarioDoEscritorio(tx, id);
  const senha = gerarSenhaTemporaria();
  await tx.usuario.update({
    where: { id },
    data: { senhaHash: await gerarHashSenha(senha), totpSegredoCifrado: null, totpAtivadoEm: null, tentativasFalhas: 0, bloqueadoAte: null },
  });
  await tx.codigoRecuperacao.deleteMany({ where: { usuarioId: id } });
  await tx.sessao.updateMany({ where: { usuarioId: id, revogadaEm: null }, data: { revogadaEm: new Date() } });
  return { senhaTemporaria: senha };
}

export async function trocarPropriaSenha(tx: Tx, usuarioId: string, sessaoAtualId: string, atual: string, nova: string, confirmacao: string) {
  const u = await usuarioDoEscritorio(tx, usuarioId);
  if (!(await senhaConfere(u.senhaHash, atual))) throw new ErroDeNegocio("A senha atual não confere.");
  if (nova !== confirmacao) throw new ErroDeNegocio("A confirmação é diferente da nova senha.");
  const problema = problemaNaSenha(nova);
  if (problema) throw new ErroDeNegocio(problema);
  if (await senhaConfere(u.senhaHash, nova)) throw new ErroDeNegocio("A nova senha precisa ser diferente da atual.");
  await tx.usuario.update({ where: { id: u.id }, data: { senhaHash: await gerarHashSenha(nova) } });
  // Encerra as outras sessões abertas.
  await tx.sessao.updateMany({ where: { usuarioId: u.id, revogadaEm: null, id: { not: sessaoAtualId } }, data: { revogadaEm: new Date() } });
}

// Carteiras -------------------------------------------------------------

export async function criarCarteira(tx: Tx, autor: Autor, e: { nome: string; responsavelId: string }) {
  if (e.nome.trim().length < 2) throw new ErroDeNegocio("Informe o nome da carteira.");
  const resp = await tx.usuario.findUnique({ where: { id: e.responsavelId } });
  if (!resp || !resp.ativo || !["ANALISTA_BPO", "ANALISTA_IRPF", "CONTADOR", "ADMINISTRADOR"].includes(resp.perfil)) {
    throw new ErroDeNegocio("Escolha um responsável da equipe interna.");
  }
  try {
    return await tx.carteira.create({ data: { escritorioId: autor.escritorioId, nome: e.nome.trim(), responsavelId: resp.id } });
  } catch (err) {
    if (ehViolacaoUnica(err)) throw new ErroDeNegocio("Já existe uma carteira com este nome.");
    throw err;
  }
}

export async function definirClientesDaCarteira(tx: Tx, autor: Autor, carteiraId: string, clienteIds: string[], responsavelId?: string) {
  const carteira = await tx.carteira.findUnique({ where: { id: carteiraId } });
  if (!carteira) throw new ErroDeNegocio("Carteira não encontrada.");
  if (responsavelId && responsavelId !== carteira.responsavelId) {
    const resp = await tx.usuario.findUnique({ where: { id: responsavelId } });
    if (!resp || !resp.ativo) throw new ErroDeNegocio("Responsável inválido.");
    await tx.carteira.update({ where: { id: carteiraId }, data: { responsavelId } });
  }
  const validos = await tx.cliente.findMany({ where: { id: { in: clienteIds } }, select: { id: true } });
  await tx.carteiraCliente.deleteMany({ where: { carteiraId, clienteId: { notIn: validos.map((c) => c.id) } } });
  for (const c of validos) {
    await tx.carteiraCliente.upsert({
      where: { carteiraId_clienteId: { carteiraId, clienteId: c.id } },
      create: { carteiraId, clienteId: c.id, escritorioId: autor.escritorioId },
      update: {},
    });
  }
}
