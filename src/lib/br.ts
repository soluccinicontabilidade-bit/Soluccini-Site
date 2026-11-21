// Validações e formatos brasileiros.

export const somenteDigitos = (s: string) => s.replace(/\D/g, "");

export function cpfValido(entrada: string): boolean {
  const c = somenteDigitos(entrada);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export function cnpjValido(entrada: string): boolean {
  const c = somenteDigitos(entrada);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s, p, i) => s + p * Number(c[i]), 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

export function formatarCpf(d: string) {
  const c = somenteDigitos(d);
  return c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}

export function formatarCnpj(d: string) {
  const c = somenteDigitos(d);
  return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export function formatarDocumento(tipo: "PF" | "PJ", d: string) {
  return tipo === "PF" ? formatarCpf(d) : formatarCnpj(d);
}

/** Mostra só os 4 últimos dígitos do CPF ou CNPJ, com o restante em asteriscos. */
export function mascararDocumento(tipo: "PF" | "PJ", final: string) {
  return tipo === "PF"
    ? `***.***.*${final.slice(0, 2)}-${final.slice(2)}`
    : `**.***.***/**${final.slice(0, 2)}-${final.slice(2)}`;
}

// Dinheiro: sempre centavos inteiros (bigint). Nunca ponto flutuante.

/** "1.234,56" | "1234,5" | "1234" | "-10,00" -> 123456n. Recusa mais de 2 casas. */
export function reaisParaCentavos(entrada: string): bigint {
  const s = entrada.trim().replace(/^R\$\s*/, "").replace(/\s/g, "");
  if (!/^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^-?\d+(,\d{1,2})?$/.test(s)) {
    throw new Error(`Valor inválido: "${entrada}". Use o formato 1.234,56.`);
  }
  const negativo = s.startsWith("-");
  const [inteiro, frac = ""] = s.replace("-", "").replace(/\./g, "").split(",");
  const centavos = BigInt(inteiro) * 100n + BigInt((frac + "00").slice(0, 2));
  return negativo ? -centavos : centavos;
}

export function formatarReais(centavos: bigint | number): string {
  const c = BigInt(centavos);
  const neg = c < 0n;
  const abs = neg ? -c : c;
  const inteiro = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}R$ ${inteiro},${frac}`;
}

/** "50" | "33,33" -> pontos-base (5000 | 3333). 100% = 10000. */
export function percentualParaBp(entrada: string): number {
  const s = entrada.trim().replace("%", "").replace(/\s/g, "");
  if (!/^\d{1,3}(,\d{1,2})?$/.test(s)) throw new Error(`Percentual inválido: "${entrada}".`);
  const [i, f = ""] = s.split(",");
  const bp = Number(i) * 100 + Number((f + "00").slice(0, 2));
  if (bp > 10000) throw new Error("O percentual não pode passar de 100%.");
  return bp;
}

export const formatarBp = (bp: number) =>
  `${Math.floor(bp / 100)},${String(bp % 100).padStart(2, "0")}%`;

// Datas civis (sem hora), sempre em UTC no banco (@db.Date).
export function dataCivil(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Data inválida: "${iso}"`);
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) throw new Error(`Data inválida: "${iso}"`);
  return d;
}

/** Aceita 31/12/2026 ou 2026-12-31. */
export function lerData(entrada: string): Date {
  const s = entrada.trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return dataCivil(br ? `${br[3]}-${br[2]}-${br[1]}` : s);
}

export const formatarData = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10).split("-").reverse().join("/") : "";

export const isoData = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

const fmtInstante = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});
export const formatarInstante = (d: Date) => fmtInstante.format(d);

/** Data de hoje no fuso de São Paulo, como data civil. */
export function hojeSaoPaulo(): Date {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  return dataCivil(iso);
}

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;
