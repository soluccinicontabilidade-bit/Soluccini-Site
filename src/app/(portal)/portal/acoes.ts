"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { comEscritorio } from "@/lib/db";
import { acessoPortalParaAcao } from "@/lib/auth/sessao";
import { ErroDeNegocio } from "@/lib/erros";
import { estadoDeErro, SEM_PERMISSAO, texto, type EstadoForm } from "@/lib/form";
import { obterClienteVisivel } from "@/lib/clientes";
import { enviarDocumento } from "@/lib/documentos";
import { decidirAprovacao } from "@/lib/financeiro/financeiro";
import { anexarAoItem } from "@/lib/irpf/irpf";
import { aceitar } from "@/lib/cobranca/aceite";

async function arquivoDe(f: FormData) {
  const arq = f.get("arquivo");
  if (!(arq instanceof File) || arq.size === 0) throw new ErroDeNegocio("Escolha o arquivo.");
  return { nome: arq.name, tipo: arq.type, conteudo: Buffer.from(await arq.arrayBuffer()) };
}

export async function acaoDecidir(clienteId: string, parcelaId: string, aprovar: boolean, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  const a = await acessoPortalParaAcao();
  if (!a) return SEM_PERMISSAO;
  try {
    await comEscritorio(a.ctx, (tx) => decidirAprovacao(tx, { id: a.usuario.id, escritorioId: a.usuario.escritorioId, perfil: a.usuario.perfil }, clienteId, parcelaId, aprovar, texto(f, "motivo")));
    revalidatePath(`/portal/${clienteId}`);
    return { ok: true, mensagem: aprovar ? "Pagamento aprovado." : "Pagamento não aprovado. O escritório foi avisado." };
  } catch (e) {
    return estadoDeErro(e, f);
  }
}

export async function acaoEnviarDoc(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  const a = await acessoPortalParaAcao();
  if (!a) return SEM_PERMISSAO;
  try {
    const arquivo = await arquivoDe(f);
    const autor = { id: a.usuario.id, escritorioId: a.usuario.escritorioId, perfil: a.usuario.perfil };
    await comEscritorio(a.ctx, async (tx) => {
      if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Sem acesso.");
      const cat = (await tx.categoriaDocumento.findFirst({ where: { nome: "Enviado pelo cliente" } })) ?? (await tx.categoriaDocumento.create({ data: { escritorioId: autor.escritorioId, nome: "Enviado pelo cliente" } }));
      await enviarDocumento(tx, autor, clienteId, { categoriaId: cat.id, titulo: texto(f, "titulo") || arquivo.nome, arquivo });
    }, { timeout: 60000 });
    revalidatePath(`/portal/${clienteId}`);
    return { ok: true, mensagem: "Documento enviado ao escritório." };
  } catch (e) {
    return estadoDeErro(e, f);
  }
}

export async function acaoEnviarIrpf(clienteId: string, declaracaoId: string, itemId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  const a = await acessoPortalParaAcao();
  if (!a) return SEM_PERMISSAO;
  try {
    const arquivo = await arquivoDe(f);
    await comEscritorio(a.ctx, (tx) => anexarAoItem(tx, { id: a.usuario.id, escritorioId: a.usuario.escritorioId, perfil: a.usuario.perfil }, declaracaoId, itemId, arquivo), { timeout: 60000 });
    revalidatePath(`/portal/${clienteId}`);
    return { ok: true, mensagem: "Recebido. Obrigado!" };
  } catch (e) {
    return estadoDeErro(e, f);
  }
}

export async function acaoAceitar(clienteId: string, solicitacaoId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  const a = await acessoPortalParaAcao();
  if (!a) return SEM_PERMISSAO;
  try {
    if (texto(f, "concordo") !== "sim") throw new ErroDeNegocio("Marque que leu e concorda com o documento.");
    const h = await headers();
    await comEscritorio(a.ctx, (tx) => aceitar(tx, { id: a.usuario.id, escritorioId: a.usuario.escritorioId, perfil: a.usuario.perfil, nome: a.usuario.nome, email: a.usuario.email }, solicitacaoId, a.ctx.ip ?? null, h.get("user-agent")));
    revalidatePath(`/portal/${clienteId}`);
    return { ok: true, mensagem: "Aceite registrado." };
  } catch (e) {
    return estadoDeErro(e, f);
  }
}
