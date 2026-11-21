import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ContextoBanco } from "@/lib/db";
import { DURACAO_SESSAO_HORAS, lerSessao, type SessaoAtual } from "./login";
import { pode, type Acao } from "./permissoes";

const seguro = process.env.NODE_ENV === "production";
// __Host- obriga HTTPS, caminho "/" e nenhum domínio: o cookie não vaza para subdomínios.
export const COOKIE_SESSAO = seguro ? "__Host-sessao" : "sessao";

export async function gravarCookieSessao(token: string) {
  (await cookies()).set(COOKIE_SESSAO, token, {
    httpOnly: true,
    secure: seguro,
    sameSite: "lax",
    path: "/",
    maxAge: DURACAO_SESSAO_HORAS * 3600,
  });
}

export async function apagarCookieSessao() {
  (await cookies()).delete(COOKIE_SESSAO);
}

export async function ipDaRequisicao(): Promise<string | null> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return ip && /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

/** Sessão da requisição atual (uma leitura do banco por requisição). */
export const sessaoAtual = cache(async (): Promise<SessaoAtual | null> => {
  const token = (await cookies()).get(COOKIE_SESSAO)?.value;
  return lerSessao(token);
});

export interface Acesso extends SessaoAtual {
  ctx: ContextoBanco;
}

/**
 * Exige usuário logado, com a verificação em duas etapas concluída, da área
 * interna e, se informado, com permissão para a ação. Redireciona se não.
 */
export async function exigirAcesso(acao?: Acao): Promise<Acesso> {
  const s = await sessaoAtual();
  if (!s) redirect("/entrar");
  if (!s.usuario.totpAtivo) redirect("/entrar/ativar-2fa");
  if (!s.doisFatoresOk) redirect("/entrar/verificacao");
  if (!pode(s.usuario.perfil, "area.interna")) redirect("/entrar?motivo=portal");
  if (acao && !pode(s.usuario.perfil, acao)) redirect("/sem-permissao");
  const ip = await ipDaRequisicao();
  return {
    ...s,
    ctx: { escritorioId: s.usuario.escritorioId, usuarioId: s.usuario.id, perfil: s.usuario.perfil, ip, origem: "web" },
  };
}

/** Para ações de formulário: mesma checagem, mas sem redirecionar no meio de um POST. */
export async function acessoParaAcao(acao?: Acao): Promise<Acesso | null> {
  const s = await sessaoAtual();
  if (!s || !s.usuario.totpAtivo || !s.doisFatoresOk || !pode(s.usuario.perfil, "area.interna")) return null;
  if (acao && !pode(s.usuario.perfil, acao)) return null;
  const ip = await ipDaRequisicao();
  return {
    ...s,
    ctx: { escritorioId: s.usuario.escritorioId, usuarioId: s.usuario.id, perfil: s.usuario.perfil, ip, origem: "web" },
  };
}
