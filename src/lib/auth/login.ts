// Regras de login, segundo fator e sessão, sem depender do Next.js (testável).
import type { PerfilUsuario, Usuario } from "@prisma/client";
import { comAutenticacao, comEscritorio, definirContexto, prisma, type Tx } from "@/lib/db";
import { cifrar, decifrarTexto, sha256, tokenAleatorio } from "@/lib/cripto";
import { senhaConfere, verificarSenhaFicticia } from "./senha";
import {
  passoDoCodigo,
  gerarCodigosRecuperacao,
  gerarSegredoTotp,
  normalizarCodigoRecuperacao,
} from "./totp";

export const MAX_TENTATIVAS = 5;
export const MAX_TENTATIVAS_IP = 30; // por IP em 15 minutos, somando todos os e-mails
export const BLOQUEIO_MINUTOS = 15;
export const DURACAO_SESSAO_HORAS = 12;
export const INATIVIDADE_MINUTOS = 120;

export interface UsuarioSessao {
  id: string;
  escritorioId: string;
  nome: string;
  email: string;
  perfil: PerfilUsuario;
  totpAtivo: boolean;
}

export interface SessaoAtual {
  sessaoId: string;
  doisFatoresOk: boolean;
  usuario: UsuarioSessao;
}

const MSG_INVALIDO = "E-mail ou senha não conferem.";

const resumo = (u: Usuario): UsuarioSessao => ({
  id: u.id,
  escritorioId: u.escritorioId,
  nome: u.nome,
  email: u.email,
  perfil: u.perfil,
  totpAtivo: !!u.totpAtivadoEm,
});

const ctxDe = (u: Pick<Usuario, "id" | "escritorioId" | "perfil">, ip?: string | null) => ({
  escritorioId: u.escritorioId,
  usuarioId: u.id,
  perfil: u.perfil,
  ip,
  origem: "web:login",
});

async function registrarFalha(tx: Tx, u: Usuario, ip?: string | null) {
  await definirContexto(tx, ctxDe(u, ip));
  const tentativas = u.tentativasFalhas + 1;
  await tx.usuario.update({
    where: { id: u.id },
    data: {
      tentativasFalhas: tentativas >= MAX_TENTATIVAS ? 0 : tentativas,
      bloqueadoAte: tentativas >= MAX_TENTATIVAS ? new Date(Date.now() + BLOQUEIO_MINUTOS * 60_000) : u.bloqueadoAte,
    },
  });
}

const mensagemBloqueio = (ate: Date) =>
  `Por segurança, o acesso foi bloqueado depois de várias tentativas. Tente de novo a partir de ${ate.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}.`;

export type ResultadoLogin =
  | { ok: true; token: string; totpAtivo: boolean }
  | { ok: false; mensagem: string };

export async function entrarComSenha(emailBruto: string, senha: string, ip?: string | null, userAgent?: string | null): Promise<ResultadoLogin> {
  const email = emailBruto.trim().toLowerCase();
  if (!email || !senha) return { ok: false, mensagem: MSG_INVALIDO };
  if (ip) {
    const recentes = await prisma.tentativaAcesso.count({ where: { ip, ocorridaEm: { gte: new Date(Date.now() - 15 * 60_000) } } });
    if (recentes >= MAX_TENTATIVAS_IP) return { ok: false, mensagem: "Muitas tentativas a partir desta rede. Aguarde 15 minutos e tente de novo." };
  }
  const falhou = async () => {
    if (ip) await prisma.tentativaAcesso.create({ data: { ip } });
  };

  // Senha é verificada fora da transação (argon2 é lento de propósito).
  const candidatos = await comAutenticacao({ email, ip }, (tx) =>
    tx.usuario.findMany({ where: { email, ativo: true } }),
  );
  if (candidatos.length === 0) {
    await verificarSenhaFicticia(senha);
    await falhou();
    return { ok: false, mensagem: MSG_INVALIDO };
  }

  const agora = new Date();
  const bloqueado = candidatos.find((u) => u.bloqueadoAte && u.bloqueadoAte > agora);
  if (bloqueado) return { ok: false, mensagem: mensagemBloqueio(bloqueado.bloqueadoAte!) };

  let certo: Usuario | null = null;
  for (const u of candidatos) {
    if (await senhaConfere(u.senhaHash, senha)) {
      certo = u;
      break;
    }
  }

  if (!certo) {
    await comAutenticacao({ email, ip }, async (tx) => {
      for (const u of candidatos) await registrarFalha(tx, u, ip);
    });
    await falhou();
    return { ok: false, mensagem: MSG_INVALIDO };
  }

  const token = tokenAleatorio();
  const u = certo;
  await comEscritorio(ctxDe(u, ip), async (tx) => {
    await tx.usuario.update({
      where: { id: u.id },
      data: { tentativasFalhas: 0, bloqueadoAte: null, ultimoAcessoEm: agora },
    });
    await tx.sessao.create({
      data: {
        escritorioId: u.escritorioId,
        usuarioId: u.id,
        tokenHash: sha256(token),
        ip: ip || null,
        userAgent: userAgent?.slice(0, 300) || null,
        doisFatoresOk: false,
        expiraEm: new Date(Date.now() + DURACAO_SESSAO_HORAS * 3600_000),
      },
    });
  });
  return { ok: true, token, totpAtivo: !!u.totpAtivadoEm };
}

export async function lerSessao(token: string | undefined | null): Promise<SessaoAtual | null> {
  if (!token || token.length > 100) return null;
  const tokenHash = sha256(token);
  return comAutenticacao({ tokenHash }, async (tx) => {
    const s = await tx.sessao.findUnique({ where: { tokenHash } });
    const agora = new Date();
    if (!s || s.revogadaEm || s.expiraEm <= agora) return null;
    await definirContexto(tx, { escritorioId: s.escritorioId, origem: "web:sessao" });
    const u = await tx.usuario.findUnique({ where: { id: s.usuarioId } });
    if (!u || !u.ativo) return null;
    // Encerra por inatividade.
    if (agora.getTime() - s.ultimoUsoEm.getTime() > INATIVIDADE_MINUTOS * 60_000) {
      await tx.sessao.update({ where: { id: s.id }, data: { revogadaEm: agora } });
      return null;
    }
    if (agora.getTime() - s.ultimoUsoEm.getTime() > 60_000) {
      await tx.sessao.update({ where: { id: s.id }, data: { ultimoUsoEm: agora } });
    }
    return { sessaoId: s.id, doisFatoresOk: s.doisFatoresOk, usuario: resumo(u) };
  });
}

export async function encerrarSessao(sessao: SessaoAtual) {
  await comEscritorio(ctxDe(sessao.usuario), (tx) =>
    tx.sessao.update({ where: { id: sessao.sessaoId }, data: { revogadaEm: new Date() } }),
  );
}

/** Confere o código do aplicativo (ou um código de recuperação) e libera a sessão. */
export async function confirmarSegundoFator(sessao: SessaoAtual, codigo: string, ip?: string | null): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  const u0 = sessao.usuario;
  return comEscritorio({ ...ctxDe(u0, ip) }, async (tx) => {
    const u = await tx.usuario.findUniqueOrThrow({ where: { id: u0.id } });
    if (u.bloqueadoAte && u.bloqueadoAte > new Date()) return { ok: false as const, mensagem: mensagemBloqueio(u.bloqueadoAte) };
    if (!u.totpSegredoCifrado || !u.totpAtivadoEm) return { ok: false as const, mensagem: "A verificação em duas etapas ainda não foi ativada." };

    let valido = false;
    const limpo = codigo.replace(/\s/g, "");
    if (/^\d{6}$/.test(limpo)) {
      const passo = passoDoCodigo(decifrarTexto(u.totpSegredoCifrado), limpo);
      // Código já usado (mesma janela ou anterior) não vale de novo.
      valido = passo !== null && (u.totpUltimoPasso === null || passo > u.totpUltimoPasso);
      if (valido) await tx.usuario.update({ where: { id: u.id }, data: { totpUltimoPasso: passo } });
    } else {
      const hash = sha256(normalizarCodigoRecuperacao(codigo));
      const rec = await tx.codigoRecuperacao.findFirst({ where: { usuarioId: u.id, codigoHash: hash, usadoEm: null } });
      if (rec) {
        await tx.codigoRecuperacao.update({ where: { id: rec.id }, data: { usadoEm: new Date() } });
        valido = true;
      }
    }

    if (!valido) {
      await registrarFalha(tx, u, ip);
      return { ok: false as const, mensagem: "Código não confere. Confira o horário do celular e tente o código mais recente." };
    }
    await tx.usuario.update({ where: { id: u.id }, data: { tentativasFalhas: 0 } });
    await tx.sessao.update({ where: { id: sessao.sessaoId }, data: { doisFatoresOk: true } });
    return { ok: true as const };
  });
}

/** Gera (ou reaproveita) um segredo ainda não confirmado para o usuário cadastrar no aplicativo. */
export async function prepararTotp(sessao: SessaoAtual): Promise<string> {
  return comEscritorio(ctxDe(sessao.usuario), async (tx) => {
    const u = await tx.usuario.findUniqueOrThrow({ where: { id: sessao.usuario.id } });
    if (u.totpAtivadoEm) throw new Error("A verificação em duas etapas já está ativa.");
    if (u.totpSegredoCifrado) return decifrarTexto(u.totpSegredoCifrado);
    const segredo = gerarSegredoTotp();
    await tx.usuario.update({ where: { id: u.id }, data: { totpSegredoCifrado: cifrar(segredo) } });
    return segredo;
  });
}

/** Ativa o TOTP depois de o usuário digitar um código válido. Devolve os códigos de recuperação (mostrados uma vez). */
export async function ativarTotp(sessao: SessaoAtual, codigo: string): Promise<{ ok: true; codigos: string[] } | { ok: false; mensagem: string }> {
  return comEscritorio(ctxDe(sessao.usuario), async (tx) => {
    const u = await tx.usuario.findUniqueOrThrow({ where: { id: sessao.usuario.id } });
    if (u.totpAtivadoEm) return { ok: false as const, mensagem: "A verificação em duas etapas já está ativa." };
    if (!u.totpSegredoCifrado) return { ok: false as const, mensagem: "Recarregue a página para gerar um novo QR code." };
    const passo = passoDoCodigo(decifrarTexto(u.totpSegredoCifrado), codigo);
    if (passo === null) {
      return { ok: false as const, mensagem: "Código não confere. Digite o código de 6 dígitos que aparece agora no aplicativo." };
    }
    const codigos = gerarCodigosRecuperacao();
    await tx.codigoRecuperacao.deleteMany({ where: { usuarioId: u.id } });
    await tx.codigoRecuperacao.createMany({
      data: codigos.map((c) => ({ escritorioId: u.escritorioId, usuarioId: u.id, codigoHash: sha256(normalizarCodigoRecuperacao(c)) })),
    });
    await tx.usuario.update({ where: { id: u.id }, data: { totpAtivadoEm: new Date(), totpUltimoPasso: passo } });
    await tx.sessao.update({ where: { id: sessao.sessaoId }, data: { doisFatoresOk: true } });
    return { ok: true as const, codigos };
  });
}
