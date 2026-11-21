"use server";

import { revalidatePath } from "next/cache";
import { comEscritorio } from "@/lib/db";
import { acessoParaAcao } from "@/lib/auth/sessao";
import { alterarUsuario, criarCarteira, criarUsuario, definirClientesDaCarteira, redefinirAcesso, trocarPropriaSenha } from "@/lib/equipe";
import { estadoDeErro, SEM_PERMISSAO, texto, type EstadoForm } from "@/lib/form";

export async function acaoCriarUsuario(_: EstadoForm, f: FormData): Promise<EstadoForm> {
  const a = await acessoParaAcao("usuarios.gerenciar");
  if (!a) return SEM_PERMISSAO;
  try {
    const r = await comEscritorio(a.ctx, (tx) => criarUsuario(tx, a.usuario, { nome: texto(f, "nome"), email: texto(f, "email"), perfil: texto(f, "perfil") }));
    revalidatePath("/equipe");
    return { ok: true, mensagem: `Usuário criado. Senha temporária: ${r.senhaTemporaria}. Entregue à pessoa por um canal seguro; ela ativa o código do celular no primeiro acesso.` };
  } catch (e) {
    return estadoDeErro(e, f);
  }
}

export async function acaoAlterarUsuario(id: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  const a = await acessoParaAcao("usuarios.gerenciar");
  if (!a) return SEM_PERMISSAO;
  try {
    await comEscritorio(a.ctx, (tx) => alterarUsuario(tx, a.usuario, id, { perfil: texto(f, "perfil"), ativo: texto(f, "ativo") === "sim" }));
    revalidatePath("/equipe");
    return { ok: true, mensagem: "Alteração salva." };
  } catch (e) {
    return estadoDeErro(e, f);
  }
}

export async function acaoRedefinirAcesso(id: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  const a = await acessoParaAcao("usuarios.gerenciar");
  if (!a) return SEM_PERMISSAO;
  try {
    const r = await comEscritorio(a.ctx, (tx) => redefinirAcesso(tx, a.usuario, id));
    revalidatePath("/equipe");
    return { ok: true, mensagem: `Nova senha temporária: ${r.senhaTemporaria}. A verificação em duas etapas foi zerada e será ativada de novo no próximo acesso.` };
  } catch (e) {
    return estadoDeErro(e, f);
  }
}

export async function acaoCriarCarteira(_: EstadoForm, f: FormData): Promise<EstadoForm> {
  const a = await acessoParaAcao("carteiras.gerenciar");
  if (!a) return SEM_PERMISSAO;
  try {
    await comEscritorio(a.ctx, (tx) => criarCarteira(tx, a.usuario, { nome: texto(f, "nome"), responsavelId: texto(f, "responsavelId") }));
    revalidatePath("/carteiras");
    return { ok: true, mensagem: "Carteira criada." };
  } catch (e) {
    return estadoDeErro(e, f);
  }
}

export async function acaoClientesDaCarteira(carteiraId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  const a = await acessoParaAcao("carteiras.gerenciar");
  if (!a) return SEM_PERMISSAO;
  try {
    await comEscritorio(a.ctx, (tx) => definirClientesDaCarteira(tx, a.usuario, carteiraId, f.getAll("clientes").map(String), texto(f, "responsavelId") || undefined));
    revalidatePath(`/carteiras/${carteiraId}`);
    return { ok: true, mensagem: "Carteira atualizada." };
  } catch (e) {
    return estadoDeErro(e, f);
  }
}

export async function acaoTrocarSenha(_: EstadoForm, f: FormData): Promise<EstadoForm> {
  const a = await acessoParaAcao();
  if (!a) return SEM_PERMISSAO;
  try {
    await comEscritorio(a.ctx, (tx) =>
      trocarPropriaSenha(tx, a.usuario.id, a.sessaoId, String(f.get("senhaAtual") ?? ""), String(f.get("novaSenha") ?? ""), String(f.get("confirmacaoSenha") ?? "")),
    );
    return { ok: true, mensagem: "Senha alterada. As outras sessões abertas foram encerradas." };
  } catch (e) {
    return estadoDeErro(e, f);
  }
}
