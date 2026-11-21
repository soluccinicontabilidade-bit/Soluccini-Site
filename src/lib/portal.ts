import type { ModuloRelatorio, PerfilUsuario, Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { ErroDeNegocio } from "@/lib/erros";
import { ehViolacaoUnica } from "@/lib/db";
import { obterClienteVisivel, registrarEvento } from "@/lib/clientes";
import { gerarHashSenha, gerarSenhaTemporaria } from "@/lib/auth/senha";
import { TIPOS_RELATORIO } from "@/lib/contabil/montar";
import { TIPOS_RELATORIO_FIN } from "@/lib/financeiro/relatorios";
import { decifrarTexto } from "@/lib/cripto";

interface Autor {
  id: string;
  escritorioId: string;
  perfil: PerfilUsuario;
}

/** Dá acesso ao portal: cria o usuário do cliente (ou liga um existente) e devolve a senha temporária, se criou. */
export async function criarAcessoPortal(tx: Tx, autor: Autor, clienteId: string, e: { nome: string; email: string; perfil: string }) {
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  if (e.perfil !== "CLIENTE_LEITOR" && e.perfil !== "CLIENTE_APROVADOR") throw new ErroDeNegocio("Escolha leitor ou aprovador.");
  const email = e.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroDeNegocio("E-mail inválido.");
  let u = await tx.usuario.findFirst({ where: { email } });
  let senhaTemporaria: string | null = null;
  if (u && !u.perfil.startsWith("CLIENTE_")) throw new ErroDeNegocio("Este e-mail é de alguém da equipe. Use outro e-mail para o portal.");
  if (!u) {
    if (e.nome.trim().length < 2) throw new ErroDeNegocio("Informe o nome.");
    senhaTemporaria = gerarSenhaTemporaria();
    try {
      u = await tx.usuario.create({ data: { escritorioId: autor.escritorioId, nome: e.nome.trim(), email, perfil: e.perfil, senhaHash: await gerarHashSenha(senhaTemporaria) } });
    } catch (err) {
      if (ehViolacaoUnica(err)) throw new ErroDeNegocio("Já existe um usuário com este e-mail.");
      throw err;
    }
  } else if (u.perfil !== e.perfil) {
    u = await tx.usuario.update({ where: { id: u.id }, data: { perfil: e.perfil } });
  }
  await tx.acessoCliente.upsert({ where: { usuarioId_clienteId: { usuarioId: u.id, clienteId } }, create: { usuarioId: u.id, clienteId, escritorioId: autor.escritorioId }, update: {} });
  await registrarEvento(tx, autor, clienteId, "portal.acesso", `Acesso ao portal liberado para ${u.nome} (${e.perfil === "CLIENTE_APROVADOR" ? "aprovador" : "leitor"})`);
  return { senhaTemporaria };
}

export async function removerAcessoPortal(tx: Tx, autor: Autor, clienteId: string, usuarioId: string) {
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  await tx.acessoCliente.deleteMany({ where: { clienteId, usuarioId } });
  if (!(await tx.acessoCliente.count({ where: { usuarioId } }))) {
    await tx.usuario.update({ where: { id: usuarioId }, data: { ativo: false } });
    await tx.sessao.updateMany({ where: { usuarioId, revogadaEm: null }, data: { revogadaEm: new Date() } });
  }
}

export async function criarAgendamento(tx: Tx, autor: Autor, clienteId: string, e: { modulo: string; tipo: string; dia: number; destinatarios: string }) {
  if (!(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Cliente não encontrado.");
  const modulo = e.modulo as ModuloRelatorio;
  const tipos = modulo === "CONTABIL" ? TIPOS_RELATORIO : modulo === "FINANCEIRO" ? TIPOS_RELATORIO_FIN : null;
  if (!tipos || !(e.tipo in tipos)) throw new ErroDeNegocio("Escolha o relatório.");
  if (!Number.isInteger(e.dia) || e.dia < 1 || e.dia > 28) throw new ErroDeNegocio("Dia do envio: de 1 a 28.");
  const emails = e.destinatarios.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (emails.some((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))) throw new ErroDeNegocio("Há e-mail inválido entre os destinatários.");
  return tx.agendamentoRelatorio.create({ data: { escritorioId: autor.escritorioId, clienteId, modulo, tipo: e.tipo, diaDoMes: e.dia, destinatarios: emails, criadoPorId: autor.id } });
}

/** LGPD: tudo o que o sistema guarda sobre a pessoa (titular), em JSON legível. */
export async function dadosDoTitular(tx: Tx, autor: Autor, pessoaId: string) {
  if (autor.perfil !== "ADMINISTRADOR") throw new ErroDeNegocio("Só o administrador exporta dados do titular.");
  const p = await tx.pessoa.findUnique({
    where: { id: pessoaId },
    include: {
      contatos: true, cliente: { include: { contratos: { include: { valores: true } }, documentos: { include: { versoes: { select: { versao: true, nomeOriginal: true, enviadoEm: true, sha256: true } }, categoria: true } } } },
      vinculosComoSocio: { include: { empresa: { select: { nome: true } } } }, vinculosComoEmpresa: { include: { socio: { select: { nome: true } } } },
      declaracoesIrpf: { include: { itens: true } }, favorecidos: { include: { titulos: { include: { parcelas: true } } } },
    },
  });
  if (!p) throw new ErroDeNegocio("Pessoa não encontrada.");
  const { documentoCifrado, documentoHash, ...resto } = p;
  void documentoHash;
  const dados = { geradoEm: new Date().toISOString(), aviso: "Dados pessoais mantidos pelo escritório (LGPD, art. 18). Arquivos de documentos são enviados à parte, mediante pedido.", titular: { ...resto, documento: decifrarTexto(documentoCifrado) } };
  if (p.cliente) await registrarEvento(tx, autor, p.cliente.id, "lgpd.exportacao", "Dados do titular exportados (LGPD)");
  return JSON.parse(JSON.stringify(dados, (k, v) => (typeof v === "bigint" ? v.toString() : k === "documentoCifrado" || k === "senhaHash" ? undefined : v))) as Prisma.JsonObject;
}
