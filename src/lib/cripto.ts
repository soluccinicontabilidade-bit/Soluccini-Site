import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function chave(nome: "CHAVE_CIFRA" | "CHAVE_INDICE"): Buffer {
  const valor = process.env[nome];
  if (!valor) throw new Error(`${nome} não configurada. Veja .env.example.`);
  const buf = Buffer.from(valor, "base64");
  if (buf.length !== 32) throw new Error(`${nome} precisa ter 32 bytes em base64.`);
  return buf;
}

const VERSAO = 1; // primeiro byte: permite trocar algoritmo ou chave no futuro

/** AES-256-GCM. Saída: versão (1) + iv (12) + tag (16) + texto cifrado. */
export function cifrar(dado: Buffer | string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave("CHAVE_CIFRA"), iv);
  const corpo = Buffer.concat([c.update(typeof dado === "string" ? Buffer.from(dado, "utf8") : dado), c.final()]);
  const saida = Buffer.concat([Buffer.from([VERSAO]), iv, c.getAuthTag(), corpo]);
  return new Uint8Array(saida); // cópia com ArrayBuffer próprio (o tipo que o Prisma espera em Bytes)
}

export function decifrar(blob: Uint8Array): Buffer {
  const b = Buffer.from(blob);
  if (b[0] !== VERSAO) throw new Error("Versão de cifra desconhecida");
  const d = createDecipheriv("aes-256-gcm", chave("CHAVE_CIFRA"), b.subarray(1, 13));
  d.setAuthTag(b.subarray(13, 29));
  return Buffer.concat([d.update(b.subarray(29)), d.final()]);
}

export const decifrarTexto = (blob: Uint8Array) => decifrar(blob).toString("utf8");

/** Índice cego: permite buscar e garantir unicidade sem guardar o valor em claro. */
export function indiceCego(valor: string): string {
  return createHmac("sha256", chave("CHAVE_INDICE")).update(valor).digest("hex");
}

export const sha256 = (dado: Buffer | string) => createHash("sha256").update(dado).digest("hex");

export function tokenAleatorio(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function iguaisSemVazamento(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
