"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ServicoContratado, SituacaoCliente, TipoVinculo } from "@prisma/client";
import { comEscritorio } from "@/lib/db";
import { acessoParaAcao } from "@/lib/auth/sessao";
import type { Acao } from "@/lib/auth/permissoes";
import {
  adicionarVinculo, alterarSituacao, atualizarPessoaDoCliente, criarCliente, criarContrato, encerrarContrato,
  encerrarVinculo, ErroDeNegocio, marcarItemChecklist, obterClienteVisivel, reajustarHonorario, type DadosPessoa,
} from "@/lib/clientes";
import { enviarDocumento, enviarNovaVersao, excluirDocumento, TAMANHO_MAXIMO } from "@/lib/documentos";
import { estadoDeErro, SEM_PERMISSAO, texto, valoresDe, type EstadoForm } from "@/lib/form";

const CAMPOS_PESSOA = [
  "tipo", "documento", "nome", "nomeFantasia", "dataNascimento", "dataAbertura", "regimeTributario", "cnaePrincipal",
  "inscricaoEstadual", "inscricaoMunicipal", "email", "telefone", "cep", "logradouro", "numero", "complemento", "bairro", "municipio", "uf",
] as const;

const pessoaDe = (f: FormData) => Object.fromEntries(CAMPOS_PESSOA.map((c) => [c, texto(f, c)])) as unknown as DadosPessoa;

/** Executa a ação no escritório do usuário, com tratamento padronizado de erros. */
async function executar(acao: Acao, f: FormData | null, fn: (a: NonNullable<Awaited<ReturnType<typeof acessoParaAcao>>>) => Promise<EstadoForm | void>): Promise<EstadoForm> {
  const a = await acessoParaAcao(acao);
  if (!a) return SEM_PERMISSAO;
  try {
    return (await fn(a)) ?? { ok: true };
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
    return estadoDeErro(e, f ?? undefined);
  }
}

const autorDe = (a: { usuario: { id: string; escritorioId: string; perfil: import("@prisma/client").PerfilUsuario } }) => ({
  id: a.usuario.id, escritorioId: a.usuario.escritorioId, perfil: a.usuario.perfil,
});

export async function acaoCriarCliente(_: EstadoForm, f: FormData): Promise<EstadoForm> {
  let destino = "";
  const r = await executar("clientes.criar", f, async (a) => {
    const r = await comEscritorio(a.ctx, (tx) =>
      criarCliente(tx, autorDe(a), {
        pessoa: pessoaDe(f),
        inicioServico: texto(f, "inicioServico"),
        regimeContabil: texto(f, "regimeContabil") === "CAIXA" ? "CAIXA" : "COMPETENCIA",
        carteiraIds: f.getAll("carteiras").map(String),
      }),
    );
    if (!r.ok) return { erros: r.erros, mensagem: "Confira os campos destacados.", valores: valoresDe(f), versao: Date.now() };
    destino = `/clientes/${r.cliente.id}?aba=entrada&novo=1`;
  });
  if (destino) redirect(destino);
  return r;
}

export async function acaoAtualizarCliente(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  let ok = false;
  const r = await executar("clientes.editar", f, async (a) => {
    const r = await comEscritorio(a.ctx, (tx) => atualizarPessoaDoCliente(tx, autorDe(a), clienteId, pessoaDe(f)));
    if (!r.ok) return { erros: r.erros, mensagem: "Confira os campos destacados.", valores: valoresDe(f), versao: Date.now() };
    ok = true;
  });
  if (ok) redirect(`/clientes/${clienteId}?salvo=1`);
  return r;
}

export async function acaoSituacao(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("clientes.situacao", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => alterarSituacao(tx, autorDe(a), clienteId, texto(f, "situacao") as SituacaoCliente, texto(f, "fim")));
    revalidatePath(`/clientes/${clienteId}`);
    return { ok: true, mensagem: "Situação atualizada." };
  });
}

export async function acaoChecklist(clienteId: string, itemId: string, concluir: boolean) {
  const a = await acessoParaAcao("clientes.editar");
  if (!a) return;
  await comEscritorio(a.ctx, (tx) => marcarItemChecklist(tx, autorDe(a), clienteId, itemId, concluir));
  revalidatePath(`/clientes/${clienteId}`);
}

export async function acaoAdicionarSocio(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("clientes.editar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) =>
      adicionarVinculo(tx, autorDe(a), clienteId, {
        documento: texto(f, "documento"), nome: texto(f, "nome"), tipo: texto(f, "tipo") as TipoVinculo,
        participacao: texto(f, "participacao"), inicio: texto(f, "inicio"),
      }),
    );
    revalidatePath(`/clientes/${clienteId}`);
    return { ok: true, mensagem: "Vínculo incluído." };
  });
}

export async function acaoEncerrarSocio(clienteId: string, vinculoId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("clientes.editar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => encerrarVinculo(tx, autorDe(a), clienteId, vinculoId, texto(f, "fim")));
    revalidatePath(`/clientes/${clienteId}`);
    return { ok: true, mensagem: "Vínculo encerrado." };
  });
}

export async function acaoCriarContrato(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("contratos.editar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) =>
      criarContrato(tx, autorDe(a), clienteId, {
        servicos: f.getAll("servicos").map(String) as ServicoContratado[],
        inicio: texto(f, "inicio"), diaVencimento: Number(texto(f, "diaVencimento")), valor: texto(f, "valor"),
      }),
    );
    revalidatePath(`/clientes/${clienteId}`);
    return { ok: true, mensagem: "Contrato cadastrado." };
  });
}

export async function acaoReajuste(clienteId: string, contratoId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("contratos.editar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) =>
      reajustarHonorario(tx, autorDe(a), clienteId, { contratoId, valor: texto(f, "valor"), vigencia: texto(f, "vigencia"), motivo: texto(f, "motivo") }),
    );
    revalidatePath(`/clientes/${clienteId}`);
    return { ok: true, mensagem: "Reajuste registrado." };
  });
}

export async function acaoEncerrarContrato(clienteId: string, contratoId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("contratos.editar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => encerrarContrato(tx, autorDe(a), clienteId, contratoId, texto(f, "fim")));
    revalidatePath(`/clientes/${clienteId}`);
    return { ok: true, mensagem: "Contrato encerrado." };
  });
}

async function arquivoDe(f: FormData, campo = "arquivo") {
  const arq = f.get(campo);
  if (!(arq instanceof File) || arq.size === 0) throw new ErroDeNegocio("Escolha o arquivo.");
  if (arq.size > TAMANHO_MAXIMO) throw new ErroDeNegocio("O arquivo passa de 20 MB.");
  return { nome: arq.name, tipo: arq.type, conteudo: Buffer.from(await arq.arrayBuffer()) };
}

export async function acaoEnviarDocumento(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("documentos.enviar", f, async (a) => {
    const arquivo = await arquivoDe(f);
    await comEscritorio(a.ctx, (tx) =>
      enviarDocumento(tx, autorDe(a), clienteId, {
        categoriaId: texto(f, "categoriaId"), titulo: texto(f, "titulo"), competencia: texto(f, "competencia"),
        validoAte: texto(f, "validoAte"), arquivo,
      }),
    { timeout: 60000 });
    revalidatePath(`/clientes/${clienteId}`);
    return { ok: true, mensagem: "Documento enviado." };
  });
}

export async function acaoNovaVersao(clienteId: string, documentoId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("documentos.enviar", f, async (a) => {
    const arquivo = await arquivoDe(f);
    await comEscritorio(a.ctx, (tx) => enviarNovaVersao(tx, autorDe(a), clienteId, documentoId, arquivo, texto(f, "validoAte")), { timeout: 60000 });
    revalidatePath(`/clientes/${clienteId}`);
    return { ok: true, mensagem: "Nova versão enviada." };
  });
}

export async function acaoExcluirDocumento(clienteId: string, documentoId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("documentos.enviar", f, async (a) => {
    await comEscritorio(a.ctx, (tx) => excluirDocumento(tx, autorDe(a), clienteId, documentoId));
    revalidatePath(`/clientes/${clienteId}`);
    return { ok: true, mensagem: "Documento retirado da lista." };
  });
}

export async function acaoEtiqueta(clienteId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  return executar("clientes.editar", f, async (a) => {
    const nome = texto(f, "nome");
    if (nome.length < 2) throw new ErroDeNegocio("Digite o nome da etiqueta.");
    await comEscritorio(a.ctx, async (tx) => {
      if (!(await obterClienteVisivel(tx, autorDe(a), clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
      const et = await tx.etiqueta.upsert({
        where: { escritorioId_nome: { escritorioId: a.usuario.escritorioId, nome } },
        create: { escritorioId: a.usuario.escritorioId, nome, cor: "#8961C8" },
        update: {},
      });
      await tx.clienteEtiqueta.upsert({
        where: { clienteId_etiquetaId: { clienteId, etiquetaId: et.id } },
        create: { clienteId, etiquetaId: et.id, escritorioId: a.usuario.escritorioId },
        update: {},
      });
    });
    revalidatePath(`/clientes/${clienteId}`);
    return { ok: true };
  });
}

export async function acaoRemoverEtiqueta(clienteId: string, etiquetaId: string) {
  const a = await acessoParaAcao("clientes.editar");
  if (!a) return;
  await comEscritorio(a.ctx, async (tx) => {
    if (await obterClienteVisivel(tx, autorDe(a), clienteId)) await tx.clienteEtiqueta.deleteMany({ where: { clienteId, etiquetaId } });
  });
  revalidatePath(`/clientes/${clienteId}`);
}
