import { hash, verify } from "@node-rs/argon2";
import { randomInt } from "node:crypto";

// argon2id com parâmetros da recomendação OWASP (19 MiB, 2 iterações).
const OPCOES = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const MINIMO_SENHA = 12;

export function problemaNaSenha(senha: string): string | null {
  if (senha.length < MINIMO_SENHA) return `A senha precisa ter pelo menos ${MINIMO_SENHA} caracteres.`;
  if (senha.length > 200) return "A senha pode ter no máximo 200 caracteres.";
  if (new Set(senha).size < 5) return "A senha repete caracteres demais. Use uma frase ou uma senha mais variada.";
  return null;
}

export const gerarHashSenha = (senha: string) => hash(senha, OPCOES);

export async function senhaConfere(hashSalvo: string, senha: string): Promise<boolean> {
  try {
    return await verify(hashSalvo, senha);
  } catch {
    return false;
  }
}

// Hash fixo usado quando o e-mail não existe, para o tempo de resposta não
// revelar quais e-mails estão cadastrados.
let hashFicticio: Promise<string> | null = null;
export function verificarSenhaFicticia(senha: string) {
  hashFicticio ??= gerarHashSenha("senha-ficticia-para-tempo-constante");
  return hashFicticio.then((h) => senhaConfere(h, senha));
}

/** Senha temporária legível: 4 grupos de 4 caracteres sem ambiguidade (sem 0/O, 1/l/I). */
export function gerarSenhaTemporaria(): string {
  const alfabeto = "abcdefghjkmnpqrstuvwxyz23456789";
  const grupos = Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => alfabeto[randomInt(alfabeto.length)]).join(""),
  );
  return grupos.join("-");
}
