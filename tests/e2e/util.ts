import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { authenticator } from "otplib";
import { expect, type Page } from "@playwright/test";

// O sistema não aceita o mesmo código do autenticador duas vezes. Entre
// logins seguidos do mesmo usuário, espera a próxima janela de 30 segundos.
const arquivo = path.join(tmpdir(), "soluccini-e2e-totp.json");
const ultimos = (): Record<string, number> => {
  try {
    return JSON.parse(readFileSync(arquivo, "utf8"));
  } catch {
    return {};
  }
};

export async function codigoNovo(email: string, segredo: string): Promise<string> {
  const u = ultimos();
  let agora = Date.now();
  while (u[email] !== undefined && Math.floor(agora / 30_000) <= u[email]) {
    await new Promise((r) => setTimeout(r, 1000));
    agora = Date.now();
  }
  // O código e o passo registrado vêm do mesmo instante.
  writeFileSync(arquivo, JSON.stringify({ ...u, [email]: Math.floor(agora / 30_000) }));
  return authenticator.clone({ epoch: agora }).generate(segredo);
}

export async function entrarCom2fa(page: Page, email: string, senha: string, segredo: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/verificacao/);
  await page.getByLabel("Código").fill(await codigoNovo(email, segredo));
  await page.getByRole("button", { name: "Confirmar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
}
