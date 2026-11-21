import { z } from "zod";
import type { PerfilUsuario, Prisma, RegimeTributario, ServicoContratado, SituacaoCliente, TipoPessoa, TipoVinculo } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { cifrar, decifrarTexto, indiceCego } from "@/lib/cripto";
import { cnpjValido, cpfValido, dataCivil, formatarBp, lerData, percentualParaBp, reaisParaCentavos, somenteDigitos, UFS } from "@/lib/br";
import { filtroClientes } from "@/lib/auth/permissoes";

export class ErroDeNegocio extends Error {}

export const NOME_REGIME: Record<RegimeTributario, string> = {
  MEI: "MEI",
  SIMPLES_NACIONAL: "Simples Nacional",
  LUCRO_PRESUMIDO: "Lucro Presumido",
  LUCRO_REAL: "Lucro Real",
};

export const NOME_SITUACAO: Record<SituacaoCliente, string> = {
  EM_ENTRADA: "Em entrada",
  ATIVO: "Ativo",
  SUSPENSO: "Suspenso",
  ENCERRADO: "Encerrado",
};

export const NOME_VINCULO: Record<TipoVinculo, string> = {
  SOCIO: "Sócio",
  SOCIO_ADMINISTRADOR: "Sócio administrador",
  ADMINISTRADOR: "Administrador",
  TITULAR: "Titular",
};

export const NOME_SERVICO: Record<ServicoContratado, string> = {
  CONTABIL: "Contábil",
  BPO_FINANCEIRO: "BPO financeiro",
  IRPF: "IRPF",
};

export const CHECKLIST_ENTRADA_PADRAO = [
  "Contrato de prestação de serviços assinado",
  "Documentos societários recebidos (contrato social e alterações)",
  "Cartão CNPJ e inscrições estadual e municipal conferidos",
  "Certificado digital ou procuração eletrônica configurados",
  "Acesso aos bancos e extratos combinado",
  "Saldos iniciais e plano de contas definidos",
  "Responsáveis internos e carteira definidos",
] as const;

// ---------------------------------------------------------------------------
// Validação dos dados de uma pessoa
// ---------------------------------------------------------------------------

const opcional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

export const esquemaPessoa = z
  .object({
    tipo: z.enum(["PF", "PJ"], { message: "Escolha pessoa física ou jurídica." }),
    documento: z.string().trim().min(1, "Informe o CPF ou CNPJ."),
    nome: z.string().trim().min(2, "Informe o nome ou a razão social.").max(200),
    nomeFantasia: opcional,
    dataNascimento: opcional,
    dataAbertura: opcional,
    regimeTributario: z
      .enum(["MEI", "SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL"])
      .optional()
      .or(z.literal("").transform(() => undefined)),
    cnaePrincipal: opcional,
    inscricaoEstadual: opcional,
    inscricaoMunicipal: opcional,
    email: opcional,
    telefone: opcional,
    cep: opcional,
    logradouro: opcional,
    numero: opcional,
    complemento: opcional,
    bairro: opcional,
    municipio: opcional,
    uf: opcional,
  })
  .superRefine((d, ctx) => {
    const doc = somenteDigitos(d.documento);
    if (d.tipo === "PF" && !cpfValido(doc)) ctx.addIssue({ code: "custom", path: ["documento"], message: "CPF inválido. Confira os dígitos." });
    if (d.tipo === "PJ" && !cnpjValido(doc)) ctx.addIssue({ code: "custom", path: ["documento"], message: "CNPJ inválido. Confira os dígitos." });
    if (d.tipo === "PF" && d.regimeTributario) ctx.addIssue({ code: "custom", path: ["regimeTributario"], message: "Regime tributário vale só para pessoa jurídica." });
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) ctx.addIssue({ code: "custom", path: ["email"], message: "E-mail inválido." });
    if (d.cep && somenteDigitos(d.cep).length !== 8) ctx.addIssue({ code: "custom", path: ["cep"], message: "O CEP tem 8 dígitos." });
    if (d.uf && !UFS.includes(d.uf.toUpperCase() as (typeof UFS)[number])) ctx.addIssue({ code: "custom", path: ["uf"], message: "UF inválida." });
    if (d.cnaePrincipal && !/^\d{7}$/.test(somenteDigitos(d.cnaePrincipal))) ctx.addIssue({ code: "custom", path: ["cnaePrincipal"], message: "O CNAE tem 7 dígitos, por exemplo 4721-1/02." });
    for (const campo of ["dataNascimento", "dataAbertura"] as const) {
      const v = d[campo];
      if (v) {
        try {
          lerData(v);
        } catch {
          ctx.addIssue({ code: "custom", path: [campo], message: "Data inválida. Use dd/mm/aaaa." });
        }
      }
    }
  });

export type DadosPessoa = z.input<typeof esquemaPessoa>;

export const hashDocumento = (doc: string) => indiceCego(somenteDigitos(doc));

function dadosPessoaParaBanco(d: z.output<typeof esquemaPessoa>) {
  const doc = somenteDigitos(d.documento);
  return {
    tipo: d.tipo as TipoPessoa,
    documentoCifrado: cifrar(doc),
    documentoHash: hashDocumento(doc),
    documentoFinal: doc.slice(-4),
    nome: d.nome,
    nomeFantasia: d.nomeFantasia ?? null,
    dataNascimento: d.tipo === "PF" && d.dataNascimento ? lerData(d.dataNascimento) : null,
    dataAbertura: d.tipo === "PJ" && d.dataAbertura ? lerData(d.dataAbertura) : null,
    regimeTributario: d.tipo === "PJ" ? (d.regimeTributario ?? null) : null,
    cnaePrincipal: d.cnaePrincipal ? somenteDigitos(d.cnaePrincipal) : null,
    inscricaoEstadual: d.inscricaoEstadual ?? null,
    inscricaoMunicipal: d.inscricaoMunicipal ?? null,
    email: d.email?.toLowerCase() ?? null,
    telefone: d.telefone ?? null,
    cep: d.cep ? somenteDigitos(d.cep) : null,
    logradouro: d.logradouro ?? null,
    numero: d.numero ?? null,
    complemento: d.complemento ?? null,
    bairro: d.bairro ?? null,
    municipio: d.municipio ?? null,
    uf: d.uf?.toUpperCase() ?? null,
  };
}

export function validarPessoa(dados: DadosPessoa) {
  const r = esquemaPessoa.safeParse(dados);
  if (!r.success) {
    const erros: Record<string, string> = {};
    for (const i of r.error.issues) erros[String(i.path[0] ?? "geral")] ??= i.message;
    return { ok: false as const, erros };
  }
  return { ok: true as const, dados: r.data };
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

interface Autor {
  id: string;
  escritorioId: string;
  perfil: PerfilUsuario;
}

export async function registrarEvento(tx: Tx, autor: Autor, clienteId: string, tipo: string, resumo: string, dados?: Prisma.InputJsonValue) {
  await tx.eventoCliente.create({
    data: { escritorioId: autor.escritorioId, clienteId, tipo, resumo, dados, usuarioId: autor.id },
  });
}

export async function criarCliente(
  tx: Tx,
  autor: Autor,
  entrada: { pessoa: DadosPessoa; inicioServico: string; regimeContabil?: "COMPETENCIA" | "CAIXA"; carteiraIds?: string[] },
) {
  const v = validarPessoa(entrada.pessoa);
  if (!v.ok) return v;
  let inicio: Date;
  try {
    inicio = lerData(entrada.inicioServico);
  } catch {
    return { ok: false as const, erros: { inicioServico: "Informe a data de início do serviço." } };
  }

  const dados = dadosPessoaParaBanco(v.dados);
  // A pessoa pode já existir (ex.: sócio cadastrado antes, agora virando cliente).
  const existente = await tx.pessoa.findUnique({
    where: { escritorioId_documentoHash: { escritorioId: autor.escritorioId, documentoHash: dados.documentoHash } },
    include: { cliente: true },
  });
  if (existente?.cliente) {
    return { ok: false as const, erros: { documento: `Este ${dados.tipo === "PF" ? "CPF" : "CNPJ"} já é do cliente ${existente.cliente.codigo} (${existente.nome}).` } };
  }
  if (existente && existente.tipo !== dados.tipo) {
    return { ok: false as const, erros: { documento: "Este documento já está cadastrado com outro tipo de pessoa." } };
  }

  const pessoa = existente
    ? await tx.pessoa.update({ where: { id: existente.id }, data: dados })
    : await tx.pessoa.create({ data: { ...dados, escritorioId: autor.escritorioId } });

  const cliente = await tx.cliente.create({
    data: {
      escritorioId: autor.escritorioId,
      pessoaId: pessoa.id,
      inicioServico: inicio,
      regimeContabil: entrada.regimeContabil ?? "COMPETENCIA",
      checklistEntrada: {
        create: CHECKLIST_ENTRADA_PADRAO.map((descricao, ordem) => ({ escritorioId: autor.escritorioId, ordem, descricao })),
      },
    },
  });
  // O código sequencial é atribuído pelo banco; relemos para tê-lo.
  const comCodigo = await tx.cliente.findUniqueOrThrow({ where: { id: cliente.id } });

  for (const carteiraId of entrada.carteiraIds ?? []) {
    await tx.carteiraCliente.create({ data: { carteiraId, clienteId: cliente.id, escritorioId: autor.escritorioId } });
  }
  await registrarEvento(tx, autor, cliente.id, "cliente.criado", `Cliente cadastrado: ${pessoa.nome}`);
  return { ok: true as const, cliente: comCodigo };
}

export async function atualizarPessoaDoCliente(tx: Tx, autor: Autor, clienteId: string, entrada: DadosPessoa) {
  const v = validarPessoa(entrada);
  if (!v.ok) return v;
  const cliente = await obterClienteVisivel(tx, autor, clienteId);
  if (!cliente) throw new ErroDeNegocio("Cliente não encontrado.");
  const dados = dadosPessoaParaBanco(v.dados);
  if (dados.tipo !== cliente.pessoa.tipo) return { ok: false as const, erros: { tipo: "Não é possível trocar entre PF e PJ. Cadastre um novo cliente." } };
  const outro = await tx.pessoa.findFirst({ where: { documentoHash: dados.documentoHash, id: { not: cliente.pessoaId } } });
  if (outro) return { ok: false as const, erros: { documento: "Este documento já pertence a outra pessoa cadastrada." } };
  await tx.pessoa.update({ where: { id: cliente.pessoaId }, data: dados });
  await registrarEvento(tx, autor, clienteId, "cliente.atualizado", "Dados cadastrais atualizados");
  return { ok: true as const };
}

export interface FiltrosClientes {
  busca?: string;
  situacao?: SituacaoCliente;
  etiquetaId?: string;
  carteiraId?: string;
}

export async function listarClientes(tx: Tx, usuario: Autor, f: FiltrosClientes = {}) {
  const e: Prisma.ClienteWhereInput[] = [filtroClientes(usuario)];
  if (f.situacao) e.push({ situacao: f.situacao });
  if (f.etiquetaId) e.push({ etiquetas: { some: { etiquetaId: f.etiquetaId } } });
  if (f.carteiraId) e.push({ carteiras: { some: { carteiraId: f.carteiraId } } });
  const busca = f.busca?.trim();
  if (busca) {
    const digitos = somenteDigitos(busca);
    const ou: Prisma.ClienteWhereInput[] = [
      { pessoa: { nome: { contains: busca, mode: "insensitive" } } },
      { pessoa: { nomeFantasia: { contains: busca, mode: "insensitive" } } },
    ];
    if (digitos.length === 11 || digitos.length === 14) ou.push({ pessoa: { documentoHash: indiceCego(digitos) } });
    if (/^\d{1,6}$/.test(busca)) ou.push({ codigo: Number(busca) });
    e.push({ OR: ou });
  }
  return tx.cliente.findMany({
    where: { AND: e },
    include: {
      pessoa: true,
      etiquetas: { include: { etiqueta: true } },
      carteiras: { include: { carteira: { include: { responsavel: { select: { nome: true } } } } } },
      _count: { select: { checklistEntrada: { where: { concluidoEm: null } } } },
    },
    orderBy: [{ pessoa: { nome: "asc" } }],
    take: 500,
  });
}

/** Devolve o cliente só se o usuário puder vê-lo (carteira ou acesso). */
export async function obterClienteVisivel(tx: Tx, usuario: Autor, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return tx.cliente.findFirst({
    where: { AND: [{ id }, filtroClientes(usuario)] },
    include: { pessoa: { include: { contatos: true } } },
  });
}

export const documentoEmClaro = (p: { documentoCifrado: Uint8Array }) => decifrarTexto(p.documentoCifrado);

export async function alterarSituacao(tx: Tx, autor: Autor, clienteId: string, nova: SituacaoCliente, fim?: string) {
  const cliente = await obterClienteVisivel(tx, autor, clienteId);
  if (!cliente) throw new ErroDeNegocio("Cliente não encontrado.");
  if (nova === "ATIVO" && cliente.situacao === "EM_ENTRADA") {
    const pendentes = await tx.itemChecklistEntrada.count({ where: { clienteId, concluidoEm: null } });
    if (pendentes > 0) throw new ErroDeNegocio(`Ainda há ${pendentes} item(ns) do checklist de entrada. Conclua-os para ativar o cliente.`);
  }
  const fimServico = nova === "ENCERRADO" ? (fim ? lerData(fim) : null) : null;
  if (nova === "ENCERRADO" && !fimServico) throw new ErroDeNegocio("Informe a data de encerramento do serviço.");
  await tx.cliente.update({ where: { id: clienteId }, data: { situacao: nova, fimServico } });
  await registrarEvento(tx, autor, clienteId, "cliente.situacao", `Situação alterada de ${NOME_SITUACAO[cliente.situacao]} para ${NOME_SITUACAO[nova]}`);
}

export async function marcarItemChecklist(tx: Tx, autor: Autor, clienteId: string, itemId: string, concluido: boolean) {
  const item = await tx.itemChecklistEntrada.findFirst({ where: { id: itemId, clienteId } });
  if (!item) throw new ErroDeNegocio("Item não encontrado.");
  await tx.itemChecklistEntrada.update({
    where: { id: itemId },
    data: concluido ? { concluidoEm: new Date(), concluidoPorId: autor.id } : { concluidoEm: null, concluidoPorId: null },
  });
  await registrarEvento(tx, autor, clienteId, "checklist.item", `${concluido ? "Concluído" : "Reaberto"}: ${item.descricao}`);
}

// ---------------------------------------------------------------------------
// Sócios e administradores
// ---------------------------------------------------------------------------

export async function adicionarVinculo(
  tx: Tx,
  autor: Autor,
  clienteId: string,
  e: { documento: string; nome: string; tipo: TipoVinculo; participacao: string; inicio: string },
) {
  const cliente = await obterClienteVisivel(tx, autor, clienteId);
  if (!cliente) throw new ErroDeNegocio("Cliente não encontrado.");
  if (cliente.pessoa.tipo !== "PJ") throw new ErroDeNegocio("Sócios só podem ser vinculados a pessoa jurídica.");

  const doc = somenteDigitos(e.documento);
  const tipoPessoa: TipoPessoa | null = cpfValido(doc) ? "PF" : cnpjValido(doc) ? "PJ" : null;
  if (!tipoPessoa) throw new ErroDeNegocio("CPF ou CNPJ do sócio inválido.");
  let bp: number;
  let inicio: Date;
  try {
    bp = e.tipo === "ADMINISTRADOR" ? 0 : percentualParaBp(e.participacao || "0");
    inicio = lerData(e.inicio);
  } catch (err) {
    throw new ErroDeNegocio(err instanceof Error ? err.message : "Dados inválidos.");
  }

  // Todas as validações antes de gravar qualquer coisa.
  const hash = hashDocumento(doc);
  const existente = await tx.pessoa.findUnique({ where: { escritorioId_documentoHash: { escritorioId: autor.escritorioId, documentoHash: hash } } });
  if (existente?.id === cliente.pessoaId) throw new ErroDeNegocio("A empresa não pode ser sócia de si mesma.");
  if (!existente && e.nome.trim().length < 2) throw new ErroDeNegocio("Informe o nome do sócio.");
  const ativos = await tx.vinculoSocietario.findMany({ where: { empresaId: cliente.pessoaId, fim: null } });
  if (existente && ativos.some((v) => v.socioId === existente.id)) {
    throw new ErroDeNegocio("Esta pessoa já tem um vínculo ativo com a empresa. Encerre o vínculo atual antes de criar outro.");
  }
  const soma = ativos.reduce((s, v) => s + v.participacaoBp, 0) + bp;
  if (soma > 10000) throw new ErroDeNegocio(`A soma das participações passaria de 100% (ficaria em ${formatarBp(soma)}).`);

  const socio =
    existente ??
    (await tx.pessoa.create({
      data: {
        escritorioId: autor.escritorioId,
        tipo: tipoPessoa,
        documentoCifrado: cifrar(doc),
        documentoHash: hash,
        documentoFinal: doc.slice(-4),
        nome: e.nome.trim(),
      },
    }));

  await tx.vinculoSocietario.create({
    data: { escritorioId: autor.escritorioId, empresaId: cliente.pessoaId, socioId: socio.id, tipo: e.tipo, participacaoBp: bp, inicio },
  });
  await registrarEvento(tx, autor, clienteId, "vinculo.criado", `${NOME_VINCULO[e.tipo]} incluído: ${socio.nome}`);
}

export async function encerrarVinculo(tx: Tx, autor: Autor, clienteId: string, vinculoId: string, fim: string) {
  const cliente = await obterClienteVisivel(tx, autor, clienteId);
  if (!cliente) throw new ErroDeNegocio("Cliente não encontrado.");
  const v = await tx.vinculoSocietario.findFirst({ where: { id: vinculoId, empresaId: cliente.pessoaId, fim: null }, include: { socio: true } });
  if (!v) throw new ErroDeNegocio("Vínculo não encontrado ou já encerrado.");
  let data: Date;
  try {
    data = lerData(fim);
  } catch {
    throw new ErroDeNegocio("Informe a data de saída.");
  }
  if (data < v.inicio) throw new ErroDeNegocio("A data de saída não pode ser anterior à entrada.");
  await tx.vinculoSocietario.update({ where: { id: v.id }, data: { fim: data } });
  await registrarEvento(tx, autor, clienteId, "vinculo.encerrado", `Vínculo encerrado: ${v.socio.nome}`);
}

// ---------------------------------------------------------------------------
// Contrato e honorários
// ---------------------------------------------------------------------------

export async function criarContrato(
  tx: Tx,
  autor: Autor,
  clienteId: string,
  e: { servicos: ServicoContratado[]; inicio: string; diaVencimento: number; valor: string },
) {
  const cliente = await obterClienteVisivel(tx, autor, clienteId);
  if (!cliente) throw new ErroDeNegocio("Cliente não encontrado.");
  if (e.servicos.length === 0) throw new ErroDeNegocio("Escolha ao menos um serviço.");
  if (!Number.isInteger(e.diaVencimento) || e.diaVencimento < 1 || e.diaVencimento > 28) throw new ErroDeNegocio("O dia de vencimento deve ser entre 1 e 28.");
  let inicio: Date;
  let valor: bigint;
  try {
    inicio = lerData(e.inicio);
    valor = reaisParaCentavos(e.valor);
  } catch (err) {
    throw new ErroDeNegocio(err instanceof Error ? err.message : "Dados inválidos.");
  }
  if (valor < 0n) throw new ErroDeNegocio("O valor não pode ser negativo.");
  const vigente = await tx.contrato.findFirst({ where: { clienteId, fim: null, excluidoEm: null } });
  if (vigente) throw new ErroDeNegocio("Já existe um contrato vigente. Encerre-o ou registre um reajuste.");
  const c = await tx.contrato.create({
    data: {
      escritorioId: autor.escritorioId,
      clienteId,
      servicos: e.servicos,
      inicio,
      diaVencimento: e.diaVencimento,
      valores: { create: { escritorioId: autor.escritorioId, valorCentavos: valor, vigenciaInicio: inicio, motivo: "Valor inicial", criadoPorId: autor.id } },
    },
  });
  await registrarEvento(tx, autor, clienteId, "contrato.criado", "Contrato cadastrado");
  return c;
}

export async function reajustarHonorario(tx: Tx, autor: Autor, clienteId: string, e: { contratoId: string; valor: string; vigencia: string; motivo: string }) {
  const contrato = await tx.contrato.findFirst({ where: { id: e.contratoId, clienteId, excluidoEm: null }, include: { valores: true } });
  if (!contrato || !(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Contrato não encontrado.");
  let valor: bigint;
  let vigencia: Date;
  try {
    valor = reaisParaCentavos(e.valor);
    vigencia = lerData(e.vigencia);
  } catch (err) {
    throw new ErroDeNegocio(err instanceof Error ? err.message : "Dados inválidos.");
  }
  if (valor < 0n) throw new ErroDeNegocio("O valor não pode ser negativo.");
  if (!e.motivo.trim()) throw new ErroDeNegocio("Informe o motivo do reajuste.");
  if (contrato.valores.some((v) => v.vigenciaInicio.getTime() >= vigencia.getTime())) {
    throw new ErroDeNegocio("A vigência do reajuste precisa ser posterior à do valor atual.");
  }
  await tx.valorHonorario.create({
    data: { escritorioId: autor.escritorioId, contratoId: contrato.id, valorCentavos: valor, vigenciaInicio: vigencia, motivo: e.motivo.trim(), criadoPorId: autor.id },
  });
  await registrarEvento(tx, autor, clienteId, "contrato.reajuste", `Honorário reajustado a partir de ${e.vigencia}`);
}

export async function encerrarContrato(tx: Tx, autor: Autor, clienteId: string, contratoId: string, fim: string) {
  const contrato = await tx.contrato.findFirst({ where: { id: contratoId, clienteId, fim: null } });
  if (!contrato || !(await obterClienteVisivel(tx, autor, clienteId))) throw new ErroDeNegocio("Contrato não encontrado.");
  const data = lerData(fim);
  if (data < contrato.inicio) throw new ErroDeNegocio("O fim não pode ser anterior ao início.");
  await tx.contrato.update({ where: { id: contrato.id }, data: { fim: data } });
  await registrarEvento(tx, autor, clienteId, "contrato.encerrado", "Contrato encerrado");
}

/** Valor vigente numa data: o de maior vigência <= data. */
export function valorVigente<T extends { vigenciaInicio: Date; valorCentavos: bigint }>(valores: T[], em: Date): T | null {
  return [...valores].filter((v) => v.vigenciaInicio <= em).sort((a, b) => b.vigenciaInicio.getTime() - a.vigenciaInicio.getTime())[0] ?? null;
}

export { dataCivil };
