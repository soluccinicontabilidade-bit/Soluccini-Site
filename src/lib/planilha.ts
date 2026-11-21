import Papa from "papaparse";
import readXlsxFile from "read-excel-file/node";
import { ErroDeNegocio } from "@/lib/erros";
import { isoData } from "@/lib/br";

export const LIMITE_LINHAS = 2000;

export const normalizarCabecalho = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/[\s.]+/g, "_");

function celula(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isoData(v);
  if (typeof v === "number") return String(v).replace(".", ","); // números do Excel viram texto à brasileira
  return String(v).trim();
}

/**
 * Lê CSV (; , ou tab) ou XLSX e devolve as linhas como registros, já com as
 * colunas traduzidas pelos apelidos aceitos.
 */
export async function lerTabela(
  nome: string,
  conteudo: Buffer,
  apelidos: Record<string, string>,
  obrigatorias: string[],
  dica: string,
): Promise<{ linhas: Record<string, string>[]; colunasIgnoradas: string[] }> {
  const ext = nome.toLowerCase().split(".").pop();
  let matriz: unknown[][];
  if (ext === "csv" || ext === "txt") {
    let texto = conteudo.toString("utf8");
    if (texto.includes("�")) texto = conteudo.toString("latin1"); // CSV salvo pelo Excel em ANSI
    matriz = Papa.parse<string[]>(texto.replace(/^﻿/, ""), { skipEmptyLines: "greedy", delimitersToGuess: [";", ",", "\t"] }).data;
  } else if (ext === "xlsx") {
    const r = await readXlsxFile(conteudo);
    matriz = (Array.isArray(r[0]?.data) ? (r[0] as { data: unknown[][] }).data : r) as unknown[][];
  } else {
    throw new ErroDeNegocio("Envie a planilha em XLSX ou CSV.");
  }
  if (matriz.length < 2) throw new ErroDeNegocio("A planilha não tem linhas de dados abaixo do cabeçalho.");
  if (matriz.length - 1 > LIMITE_LINHAS) throw new ErroDeNegocio(`A planilha passa de ${LIMITE_LINHAS} linhas. Divida em arquivos menores.`);

  const cabecalho = matriz[0].map((c) => normalizarCabecalho(celula(c)));
  const campos = cabecalho.map((c) => apelidos[c]);
  if (!obrigatorias.every((o) => campos.includes(o))) throw new ErroDeNegocio(dica);
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
