import { randomUUID } from "node:crypto";
import { authenticator } from "otplib";
import type { PerfilUsuario } from "@prisma/client";
import { comEscritorio } from "@/lib/db";
import { cifrar, indiceCego } from "@/lib/cripto";
import { gerarHashSenha } from "@/lib/auth/senha";
import { CATEGORIAS_PADRAO } from "@/lib/documentos";

export const temBanco = !!process.env.TEST_DATABASE_URL;
export const SENHA = "senha de teste muito boa";

let contador = 0;
export function cnpjFicticio(): string {
  // Gera um CNPJ válido e único por chamada.
  const raiz = String(10000000 + ((Date.now() + contador++ * 7919) % 89999999)).slice(0, 8);
  const b = raiz + "0001";
  const dv = (s: string, p: number[]) => { const r = p.reduce((a, x, i) => a + x * Number(s[i]), 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(b, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return b + d1 + dv(b + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
}

export async function novoEscritorio() {
  const escritorioId = randomUUID();
  const cnpj = cnpjFicticio();
  const sufixo = randomUUID().slice(0, 8);
  const usuarios = await comEscritorio({ escritorioId, origem: "teste" }, async (tx) => {
    await tx.escritorio.create({ data: { id: escritorioId, nome: `Teste ${sufixo}`, cnpjCifrado: cifrar(cnpj), cnpjHash: indiceCego(cnpj), cnpjFinal: cnpj.slice(-4) } });
    await tx.categoriaDocumento.createMany({ data: CATEGORIAS_PADRAO.map((c) => ({ ...c, escritorioId })) });
    const hash = await gerarHashSenha(SENHA);
    const criar = (perfil: PerfilUsuario, nome: string) =>
      tx.usuario.create({ data: { escritorioId, nome, email: `${nome}-${sufixo}@teste.local`, perfil, senhaHash: hash } });
    return {
      admin: await criar("ADMINISTRADOR", "admin"),
      contador: await criar("CONTADOR", "contador"),
      bpo: await criar("ANALISTA_BPO", "bpo"),
      outroBpo: await criar("ANALISTA_BPO", "outrobpo"),
    };
  });
  const autor = (u: { id: string; perfil: PerfilUsuario }) => ({ id: u.id, escritorioId, perfil: u.perfil });
  const ctx = (u: { id: string; perfil: PerfilUsuario }) => ({ escritorioId, usuarioId: u.id, perfil: u.perfil, origem: "teste" });
  return { escritorioId, ...usuarios, autor, ctx };
}

export const codigoTotp = (segredo: string) => authenticator.generate(segredo);
/** Código da próxima janela de 30 s (aceito pela tolerância de 1 janela). */
export const codigoTotpSeguinte = (segredo: string) => authenticator.clone({ epoch: Date.now() + 30_000 }).generate(segredo);
