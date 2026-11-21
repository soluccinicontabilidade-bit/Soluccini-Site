import Papa from "papaparse";
import readXlsxFile from "read-excel-file/node";
import { randomUUID } from "node:crypto";
import type { PerfilUsuario, Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { sha256 } from "@/lib/cripto";
import { gravarArquivo, lerArquivo } from "@/lib/armazenamento";
import { cnpjValido, cpfValido, isoData, hojeSaoPaulo, lerData, somenteDigitos } from "@/lib/br";
import { criarCliente, ErroDeNegocio, hashDocumento, validarPessoa, type DadosPessoa } from "@/lib/clientes";

export const LIMITE_LINHAS = 2000;

// Nomes de coluna aceitos (sem acento, minúsculas, espaços viram _).
const APELIDOS: Record<string, string> = {
  tipo: "tipo", tipo_pessoa: "tipo", pessoa: "tipo",
  cpf_cnpj: "documento", cnpj_cpf: "documento", cpf: "documento", cnpj: "documento", documento: "documento",
  nome: "nome", razao_social: "nome", nome_razao_social: "nome",
  nome_fantasia: "nomeFantasia", fantasia: "nomeFantasia",
  regime: "regimeTributario", regime_tributario: "regimeTributario",
  cnae: "cnaePrincipal", cnae_principal: "cnaePrincipal",
  ie: "inscricaoEstadual", inscricao_estadual: "inscricaoEstadual",
  im: "inscricaoMunicipal", inscricao_municipal: "inscricaoMunicipal",
  email: "email", "e-mail": "email", e_mail: "email",
  telefone: "telefone", fone: "telefone", celular: "telefone", whatsapp: "telefone",
  cep: "cep", logradouro: "logradouro", endereco: "logradouro", rua: "logradouro",
  numero: "numero", no: "numero", complemento: "complemento", bairro: "bairro",
  municipio: "municipio", cidade: "municipio", uf: "uf", estado: "uf",
  inicio_servico: "inicioServico", inicio: "inicioServico", data_inicio: "inicioServico", cliente_desde: "inicioServico",
  data_abertura: "dataAbertura", abertura: "dataAbertura",
  data_nascimento: "dataNascimento", nascimento: "dataNascimento",
};

export const COLUNAS_MODELO = [
  "tipo", "cpf_cnpj", "nome", "nome_fantasia", "regime", "cnae", "email", "telefone",
  "cep", "logradouro", "numero", "complemento", "bairro", "municipio", "uf", "inicio_servico",
];

const normalizarCabecalho = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/[\s.]+/g, "_");

function celula(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isoData(v);
  return String(v).trim();
}

/** Lê CSV (separado por ; ou ,) ou XLSX e devolve linhas com chaves já traduzidas. */
export async function lerPlanilha(nome: string, conteudo: Buffer): Promise<{ linhas: Record<string, string>[]; colunasIgnoradas: string[] }> {
  const ext = nome.toLowerCase().split(".").pop();
  let matriz: unknown[][];
  if (ext === "csv" || ext === "txt") {
    let texto = conteudo.toString("utf8");
    if (texto.includes("�")) texto = conteudo.toString("latin1"); // planilhas salvas pelo Excel em ANSI
    const r = Papa.parse<string[]>(texto.replace(/^﻿/, ""), { skipEmptyLines: "greedy", delimitersToGuess: [";", ",", "\t"] });
    matriz = r.data;
  } else if (ext === "xlsx") {
    const r = await readXlsxFile(conteudo);
    matriz = (Array.isArray(r[0]?.data) ? (r[0] as { data: unknown[][] }).data : r) as unknown[][];
  } else {
    throw new ErroDeNegocio("Envie a planilha em XLSX ou CSV.");
  }
  if (matriz.length < 2) throw new ErroDeNegocio("A planilha não tem linhas de dados abaixo do cabeçalho.");
  if (matriz.length - 1 > LIMITE_LINHAS) throw new ErroDeNegocio(`A planilha passa de ${LIMITE_LINHAS} linhas. Divida em arquivos menores.`);

  const cabecalho = matriz[0].map((c) => normalizarCabecalho(celula(c)));
  const campos = cabecalho.map((c) => APELIDOS[c]);
  if (!campos.includes("documento") || !campos.includes("nome")) {
    throw new ErroDeNegocio("A primeira linha precisa ter pelo menos as colunas cpf_cnpj e nome. Baixe o modelo para ver o formato.");
  }
  const colunasIgnoradas = cabecalho.filter((c, i) => c && !campos[i]);
  const linhas = matriz.slice(1).map((linha) => {
    const reg: Record<string, string> = {};
    campos.forEach((campo, i) => {
      if (campo) reg[campo] = celula(linha[i]);
    });
    return reg;
  });
  return { linhas, colunasIgnoradas };
}

function lerRegime(v: string): string | undefined {
  const s = normalizarCabecalho(v);
  if (!s) return undefined;
  if (s.includes("mei")) return "MEI";
  if (s.includes("simples")) return "SIMPLES_NACIONAL";
  if (s.includes("presumido")) return "LUCRO_PRESUMIDO";
  if (s.includes("real")) return "LUCRO_REAL";
  return "INVALIDO";
}

export interface LinhaAnalisada {
  numero: number; // linha na planilha (cabeçalho = 1)
  nome: string;
  documentoFinal: string;
  acao: "criar" | "ignorar" | "erro";
  mensagens: string[];
  dados?: { pessoa: DadosPessoa; inicioServico: string };
}

/** Valida todas as linhas sem gravar nada. */
export function analisarLinhas(linhas: Record<string, string>[], hashesExistentes: Set<string>, hoje = hojeSaoPaulo()): LinhaAnalisada[] {
  const vistosNoArquivo = new Map<string, number>();
  return linhas.map((l, i) => {
    const numero = i + 2;
    const doc = somenteDigitos(l.documento ?? "");
    const base = { numero, nome: l.nome ?? "", documentoFinal: doc.slice(-4) };
    const tipoInformado = (l.tipo ?? "").toUpperCase().replace(/[^A-Z]/g, "");
    const tipo = tipoInformado === "PF" || tipoInformado === "PJ"
      ? tipoInformado
      : cpfValido(doc) ? "PF" : cnpjValido(doc) ? "PJ" : doc.length === 11 ? "PF" : "PJ";

    const regime = lerRegime(l.regimeTributario ?? "");
    const pessoa: DadosPessoa = {
      tipo,
      documento: doc,
      nome: l.nome ?? "",
      nomeFantasia: l.nomeFantasia,
      regimeTributario: (regime === "INVALIDO" ? undefined : regime) as DadosPessoa["regimeTributario"],
      cnaePrincipal: l.cnaePrincipal,
      inscricaoEstadual: l.inscricaoEstadual,
      inscricaoMunicipal: l.inscricaoMunicipal,
      email: l.email,
      telefone: l.telefone,
      cep: l.cep,
      logradouro: l.logradouro,
      numero: l.numero,
      complemento: l.complemento,
      bairro: l.bairro,
      municipio: l.municipio,
      uf: l.uf,
      dataAbertura: l.dataAbertura,
      dataNascimento: l.dataNascimento,
    };
    const mensagens: string[] = [];
    const v = validarPessoa(pessoa);
    if (!v.ok) mensagens.push(...Object.values(v.erros));
    if (regime === "INVALIDO") mensagens.push(`Regime "${l.regimeTributario}" não reconhecido. Use MEI, Simples, Presumido ou Real.`);
    if (tipo === "PF" && regime && regime !== "INVALIDO") mensagens.push("Regime tributário vale só para pessoa jurídica.");
    const inicioServico = l.inicioServico || isoData(hoje);
    try {
      lerData(inicioServico);
    } catch {
      mensagens.push(`Data de início "${l.inicioServico}" inválida. Use dd/mm/aaaa.`);
    }
    if (mensagens.length) return { ...base, acao: "erro" as const, mensagens: [...new Set(mensagens)] };

    if (vistosNoArquivo.has(doc)) {
      return { ...base, acao: "erro" as const, mensagens: [`Documento repetido na linha ${vistosNoArquivo.get(doc)}.`] };
    }
    vistosNoArquivo.set(doc, numero);
    if (hashesExistentes.has(hashDocumento(doc))) {
      return { ...base, acao: "ignorar" as const, mensagens: ["Já é cliente. A linha será ignorada."] };
    }
    const avisos = l.inicioServico ? [] : ["Sem data de início: será usada a data de hoje."];
    return { ...base, acao: "criar" as const, mensagens: avisos, dados: { pessoa, inicioServico } };
  });
}

interface Autor {
  id: string;
  escritorioId: string;
  perfil: PerfilUsuario;
}

async function hashesDeClientes(tx: Tx) {
  const pessoas = await tx.pessoa.findMany({ where: { cliente: { isNot: null } }, select: { documentoHash: true } });
  return new Set(pessoas.map((p) => p.documentoHash));
}

const resumir = (a: LinhaAnalisada[]) => ({
  criar: a.filter((l) => l.acao === "criar").length,
  ignorar: a.filter((l) => l.acao === "ignorar").length,
  erros: a.filter((l) => l.acao === "erro").length,
});

/** Etapa 1: recebe o arquivo, valida e guarda o resultado. Nada é cadastrado ainda. */
export async function receberImportacaoClientes(tx: Tx, autor: Autor, arquivo: { nome: string; conteudo: Buffer }) {
  const ext = arquivo.nome.toLowerCase().split(".").pop();
  if (!["csv", "xlsx", "txt"].includes(ext ?? "")) throw new ErroDeNegocio("Envie a planilha em XLSX ou CSV.");
  if (arquivo.conteudo.length > 5 * 1024 * 1024) throw new ErroDeNegocio("A planilha passa de 5 MB.");
  const hash = sha256(arquivo.conteudo);
  const jaAplicada = await tx.importacao.findFirst({ where: { tipo: "CLIENTES", sha256: hash, situacao: "APLICADA" } });
  if (jaAplicada) throw new ErroDeNegocio("Esta mesma planilha já foi importada. Nada foi feito de novo.");

  const { linhas, colunasIgnoradas } = await lerPlanilha(arquivo.nome, arquivo.conteudo);
  const analise = analisarLinhas(linhas, await hashesDeClientes(tx));
  const resumo = resumir(analise);

  const chave = `${autor.escritorioId}/importacoes/${randomUUID()}`;
  await gravarArquivo(chave, arquivo.conteudo);
  return tx.importacao.create({
    data: {
      escritorioId: autor.escritorioId,
      tipo: "CLIENTES",
      situacao: resumo.erros > 0 ? "COM_ERROS" : "PRONTA",
      chaveArquivo: chave,
      nomeOriginal: arquivo.nome.slice(0, 200),
      sha256: hash,
      resumo: { ...resumo, colunasIgnoradas } as Prisma.InputJsonValue,
      erros: analise.map(({ dados: _d, ...resto }) => resto) as unknown as Prisma.InputJsonValue,
      criadoPorId: autor.id,
    },
  });
}

/**
 * Etapa 2: aplica. Relê e revalida o arquivo guardado (o cadastro pode ter
 * mudado desde a análise) e cria tudo numa única transação: ou entra tudo,
 * ou nada.
 */
export async function aplicarImportacaoClientes(tx: Tx, autor: Autor, importacaoId: string) {
  const imp = await tx.importacao.findUnique({ where: { id: importacaoId } });
  if (!imp || imp.tipo !== "CLIENTES") throw new ErroDeNegocio("Importação não encontrada.");
  if (imp.situacao !== "PRONTA") throw new ErroDeNegocio("Esta importação não está pronta para ser aplicada.");
  const repetida = await tx.importacao.findFirst({ where: { tipo: "CLIENTES", sha256: imp.sha256, situacao: "APLICADA" } });
  if (repetida) throw new ErroDeNegocio("Esta mesma planilha já foi importada.");

  const { linhas } = await lerPlanilha(imp.nomeOriginal, await lerArquivo(imp.chaveArquivo));
  const analise = analisarLinhas(linhas, await hashesDeClientes(tx));
  if (analise.some((l) => l.acao === "erro")) throw new ErroDeNegocio("O cadastro mudou desde a análise e agora há linhas com erro. Envie a planilha de novo.");

  let criados = 0;
  for (const l of analise) {
    if (l.acao !== "criar" || !l.dados) continue;
    const r = await criarCliente(tx, autor, l.dados);
    if (!r.ok) throw new ErroDeNegocio(`Linha ${l.numero}: ${Object.values(r.erros)[0]}`);
    criados++;
  }
  await tx.importacao.update({
    where: { id: imp.id },
    data: { situacao: "APLICADA", aplicadaEm: new Date(), resumo: { ...(imp.resumo as object), criados } as Prisma.InputJsonValue },
  });
  return { criados };
}

export async function cancelarImportacao(tx: Tx, importacaoId: string) {
  const imp = await tx.importacao.findUnique({ where: { id: importacaoId } });
  if (!imp || imp.situacao === "APLICADA") throw new ErroDeNegocio("Esta importação não pode ser cancelada.");
  await tx.importacao.update({ where: { id: imp.id }, data: { situacao: "CANCELADA" } });
}

export function modeloCsv(): string {
  const exemplo = ["PJ", "11.222.333/0001-81", "Padaria Pão Quente Ltda", "Pão Quente", "Simples", "1091-1/02", "contato@paoquente.com.br", "(11) 99999-0000", "01310-100", "Av. Paulista", "1000", "Loja 2", "Bela Vista", "São Paulo", "SP", "01/01/2026"];
  return "﻿" + [COLUNAS_MODELO.join(";"), exemplo.join(";")].join("\r\n") + "\r\n";
}
