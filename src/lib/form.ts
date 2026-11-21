import { ErroDeNegocio } from "@/lib/clientes";
import { mensagemDoBanco } from "@/lib/db";

export interface EstadoForm {
  ok?: boolean;
  mensagem?: string;
  erros?: Record<string, string>;
  valores?: Record<string, string>;
  versao?: number;
  dados?: Record<string, unknown>;
}

export const texto = (f: FormData, nome: string) => {
  const v = f.get(nome);
  return typeof v === "string" ? v.trim() : "";
};

export const valoresDe = (f: FormData): Record<string, string> => {
  const r: Record<string, string> = {};
  for (const [k, v] of f.entries()) if (typeof v === "string" && !k.startsWith("$") && !/senha|codigo/i.test(k)) r[k] = v;
  return r;
};

export const SEM_PERMISSAO: EstadoForm = { mensagem: "Sua sessão expirou ou você não tem permissão para esta ação. Entre de novo." };

/** Converte erros esperados em mensagem para a pessoa; erros inesperados são registrados e viram mensagem genérica. */
export function estadoDeErro(e: unknown, f?: FormData): EstadoForm {
  const valores = f ? valoresDe(f) : undefined;
  if (e instanceof ErroDeNegocio) return { mensagem: e.message, valores, versao: Date.now() };
  const doBanco = mensagemDoBanco(e);
  if (doBanco && /Período|Lançamento|não fecha|já existe/i.test(doBanco)) return { mensagem: doBanco, valores, versao: Date.now() };
  console.error(e);
  return { mensagem: "Não foi possível concluir agora. Tente de novo; se continuar, avise o administrador.", valores, versao: Date.now() };
}
