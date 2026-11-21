"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { comEscritorio } from "@/lib/db";
import { acessoParaAcao } from "@/lib/auth/sessao";
import { ErroDeNegocio } from "@/lib/clientes";
import { aplicarImportacaoClientes, cancelarImportacao, receberImportacaoClientes } from "@/lib/importacao";
import { estadoDeErro, SEM_PERMISSAO, type EstadoForm } from "@/lib/form";

export async function acaoReceber(_: EstadoForm, f: FormData): Promise<EstadoForm> {
  const a = await acessoParaAcao("importacao.clientes");
  if (!a) return SEM_PERMISSAO;
  let id = "";
  try {
    const arq = f.get("arquivo");
    if (!(arq instanceof File) || arq.size === 0) throw new ErroDeNegocio("Escolha a planilha.");
    const conteudo = Buffer.from(await arq.arrayBuffer());
    const imp = await comEscritorio(a.ctx, (tx) => receberImportacaoClientes(tx, a.usuario, { nome: arq.name, conteudo }), { timeout: 60000 });
    id = imp.id;
  } catch (e) {
    return estadoDeErro(e);
  }
  redirect(`/importacoes/${id}`);
}

export async function acaoAplicar(id: string, _: EstadoForm): Promise<EstadoForm> {
  const a = await acessoParaAcao("importacao.clientes");
  if (!a) return SEM_PERMISSAO;
  try {
    const r = await comEscritorio({ ...a.ctx, origem: "web:importacao" }, (tx) => aplicarImportacaoClientes(tx, a.usuario, id), { timeout: 120000 });
    revalidatePath(`/importacoes/${id}`);
    return { ok: true, mensagem: `${r.criados} cliente(s) cadastrado(s).` };
  } catch (e) {
    return estadoDeErro(e);
  }
}

export async function acaoCancelar(id: string, _: EstadoForm): Promise<EstadoForm> {
  const a = await acessoParaAcao("importacao.clientes");
  if (!a) return SEM_PERMISSAO;
  try {
    await comEscritorio(a.ctx, (tx) => cancelarImportacao(tx, id));
  } catch (e) {
    return estadoDeErro(e);
  }
  redirect("/importacoes");
}
