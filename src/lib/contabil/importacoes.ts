// Importação de plano de contas e de saldos iniciais em duas etapas, com o
// arquivo guardado (cifrado): 1) recebe e confere; 2) aplica após confirmação.
import { randomUUID } from "node:crypto";
import type { PerfilUsuario, Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { ErroDeNegocio } from "@/lib/erros";
import { sha256 } from "@/lib/cripto";
import { gravarArquivo, lerArquivo } from "@/lib/armazenamento";
import { obterClienteVisivel, registrarEvento } from "@/lib/clientes";
import { formatarReais, lerData } from "@/lib/br";
import { criarPlanoVazio, importarPlano } from "./plano";
import { analisarSaldosIniciais, aplicarSaldosIniciais } from "./lancamentos";

interface Autor {
  id: string;
  escritorioId: string;
  perfil: PerfilUsuario;
}

export interface LinhaConferencia {
  numero: number;
  rotulo: string;
  detalhe: string;
  acao: "criar" | "ignorar" | "erro";
  mensagens: string[];
}

async function guardar(tx: Tx, autor: Autor, clienteId: string, tipo: "PLANO_DE_CONTAS" | "SALDOS_INICIAIS", arquivo: { nome: string; conteudo: Buffer }, dados: { linhas: LinhaConferencia[]; resumo: Record<string, unknown>; ok: boolean }) {
  const chave = `${autor.escritorioId}/importacoes/${randomUUID()}`;
  await gravarArquivo(chave, arquivo.conteudo);
  return tx.importacao.create({
    data: {
      escritorioId: autor.escritorioId, clienteId, tipo, situacao: dados.ok ? "PRONTA" : "COM_ERROS",
      chaveArquivo: chave, nomeOriginal: arquivo.nome.slice(0, 200), sha256: sha256(arquivo.conteudo),
      resumo: dados.resumo as Prisma.InputJsonValue, erros: dados.linhas as unknown as Prisma.InputJsonValue, criadoPorId: autor.id,
    },
  });
}

function validarArquivo(arquivo: { nome: string; conteudo: Buffer }) {
  if (!/\.(csv|xlsx|txt)$/i.test(arquivo.nome)) throw new ErroDeNegocio("Envie a planilha em XLSX ou CSV.");
  if (arquivo.conteudo.length > 5 * 1024 * 1024) throw new ErroDeNegocio("A planilha passa de 5 MB.");
}

export async function receberPlano(tx: Tx, autor: Autor, clienteId: string, arquivo: { nome: string; conteudo: Buffer }) {
  validarArquivo(arquivo);
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  const plano = await criarPlanoVazio(tx, autor, clienteId);
  const a = await importarPlano(tx, autor.escritorioId, plano.id, arquivo, false);
  return guardar(tx, autor, clienteId, "PLANO_DE_CONTAS", arquivo, {
    ok: !a.temErro && a.criar > 0,
    resumo: { criar: a.criar, ignorar: a.linhas.filter((l) => l.acao === "ignorar").length, erros: a.linhas.filter((l) => l.acao === "erro").length },
    linhas: a.linhas.map((l) => ({ numero: l.numero, rotulo: l.codigo, detalhe: l.nome, acao: l.acao, mensagens: l.mensagens })),
  });
}

export async function receberSaldos(tx: Tx, autor: Autor, clienteId: string, data: string, arquivo: { nome: string; conteudo: Buffer }) {
  validarArquivo(arquivo);
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  try {
    lerData(data);
  } catch {
    throw new ErroDeNegocio("Informe a data dos saldos iniciais.");
  }
  const a = await analisarSaldosIniciais(tx, clienteId, arquivo);
  const fecha = a.debitos === a.creditos && a.debitos > 0n;
  const linhas: LinhaConferencia[] = a.linhas.map((l) => ({
    numero: l.numero, rotulo: l.conta, detalhe: l.nome,
    acao: l.mensagens.length ? "erro" : "criar",
    mensagens: l.mensagens.length ? l.mensagens : [`${l.tipo === "DEBITO" ? "Devedor" : "Credor"}: ${formatarReais(l.valor ?? 0n)}`],
  }));
  return guardar(tx, autor, clienteId, "SALDOS_INICIAIS", arquivo, {
    ok: !a.temErro && fecha,
    resumo: {
      data, criar: linhas.filter((l) => l.acao === "criar").length, erros: linhas.filter((l) => l.acao === "erro").length,
      debitos: formatarReais(a.debitos), creditos: formatarReais(a.creditos),
      diferenca: a.debitos === a.creditos ? null : formatarReais(a.debitos - a.creditos),
    },
    linhas,
  });
}

export async function aplicarImportacaoContabil(tx: Tx, autor: Autor, clienteId: string, importacaoId: string) {
  const imp = await tx.importacao.findFirst({ where: { id: importacaoId, clienteId } });
  if (!imp) throw new ErroDeNegocio("Importação não encontrada.");
  if (imp.situacao !== "PRONTA") throw new ErroDeNegocio("Esta importação não está pronta para ser aplicada.");
  const arquivo = { nome: imp.nomeOriginal, conteudo: await lerArquivo(imp.chaveArquivo) };
  let resumoFinal: Record<string, unknown> = { ...(imp.resumo as object) };
  if (imp.tipo === "PLANO_DE_CONTAS") {
    const plano = await criarPlanoVazio(tx, autor, clienteId);
    const r = await importarPlano(tx, autor.escritorioId, plano.id, arquivo, true);
    if (r.temErro) throw new ErroDeNegocio("O plano mudou desde a conferência e agora há linhas com erro. Envie a planilha de novo.");
    resumoFinal = { ...resumoFinal, criadas: r.criar };
    await registrarEvento(tx, autor, clienteId, "plano.importado", `${r.criar} conta(s) importada(s) de ${imp.nomeOriginal}`);
  } else if (imp.tipo === "SALDOS_INICIAIS") {
    const data = String((imp.resumo as { data?: string }).data ?? "");
    const l = await aplicarSaldosIniciais(tx, autor, clienteId, data, arquivo);
    resumoFinal = { ...resumoFinal, lancamento: l.numero };
  } else {
    throw new ErroDeNegocio("Tipo de importação inválido aqui.");
  }
  await tx.importacao.update({ where: { id: imp.id }, data: { situacao: "APLICADA", aplicadaEm: new Date(), resumo: resumoFinal as Prisma.InputJsonValue } });
}
