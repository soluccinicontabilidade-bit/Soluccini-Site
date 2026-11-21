"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { ativarTotp, confirmarSegundoFator, encerrarSessao, entrarComSenha } from "@/lib/auth/login";
import { apagarCookieSessao, gravarCookieSessao, ipDaRequisicao, sessaoAtual } from "@/lib/auth/sessao";
import { texto, type EstadoForm } from "@/lib/form";

export async function acaoEntrar(_: EstadoForm, f: FormData): Promise<EstadoForm> {
  const email = texto(f, "email");
  const r = await entrarComSenha(email, String(f.get("senha") ?? ""), await ipDaRequisicao(), (await headers()).get("user-agent"));
  if (!r.ok) return { mensagem: r.mensagem, valores: { email }, versao: Date.now() };
  await gravarCookieSessao(r.token);
  redirect(r.totpAtivo ? "/entrar/verificacao" : "/entrar/ativar-2fa");
}

export async function acaoVerificar(_: EstadoForm, f: FormData): Promise<EstadoForm> {
  const s = await sessaoAtual();
  if (!s) redirect("/entrar");
  const r = await confirmarSegundoFator(s, texto(f, "codigo"), await ipDaRequisicao());
  if (!r.ok) return { mensagem: r.mensagem, erros: { codigo: r.mensagem }, versao: Date.now() };
  redirect("/");
}

export async function acaoAtivar2fa(_: EstadoForm, f: FormData): Promise<EstadoForm> {
  const s = await sessaoAtual();
  if (!s) redirect("/entrar");
  const r = await ativarTotp(s, texto(f, "codigo"));
  if (!r.ok) return { mensagem: r.mensagem, erros: { codigo: r.mensagem }, versao: Date.now() };
  return { ok: true, mensagem: "Verificação em duas etapas ativada.", dados: { codigos: r.codigos } };
}

export async function acaoSair() {
  const s = await sessaoAtual();
  if (s) await encerrarSessao(s);
  await apagarCookieSessao();
  redirect("/entrar");
}
