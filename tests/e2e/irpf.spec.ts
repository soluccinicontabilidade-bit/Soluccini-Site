import { expect, test } from "@playwright/test";
import { authenticator } from "otplib";

const SENHA = process.env.E2E_SENHA ?? "";
const TOTP = process.env.E2E_TOTP ?? "";

test("IRPF: abre declaração, contribuinte envia pelo link sem login, simula", async ({ page, browser }) => {
  test.skip(!SENHA || !TOTP, "Defina E2E_SENHA e E2E_TOTP");
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill("admin@soluccini.local");
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/verificacao/);
  await page.getByLabel("Código").fill(authenticator.generate(TOTP));
  await page.getByRole("button", { name: "Confirmar" }).click();
  await page.waitForURL(/\/$/);

  // Ano aleatório para o teste poder rodar de novo.
  const ano = 2030 + Math.floor(Math.random() * 60);
  await page.goto(`/irpf/nova?ano=${ano}`);
  await page.getByLabel("Contribuinte").selectOption({ label: "Mariana Souza (cliente)" });
  await page.getByLabel("Honorário (R$)").fill("450,00");
  await page.getByRole("button", { name: "Abrir declaração" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mariana Souza" })).toBeVisible();
  await expect(page.getByText("Aguardando documentos").first()).toBeVisible();

  await page.getByRole("button", { name: "Gerar link de envio para o contribuinte" }).click();
  const link = await page.getByLabel("Link de envio").inputValue();
  expect(link).toMatch(/\/enviar\/[A-Za-z0-9_-]{40,}$/);

  // Contribuinte, sem login
  const anon = await browser.newContext();
  const p2 = await anon.newPage();
  await p2.goto(link.replace(/^https?:\/\/[^/]+/, process.env.E2E_URL ?? "http://127.0.0.1:3000"));
  await expect(p2.getByRole("heading", { name: "Olá, Mariana." })).toBeVisible();
  const item = p2.locator("li", { hasText: "Informes de rendimentos do trabalho" });
  await item.locator('input[type="file"]').setInputFiles({ name: "informe.pdf", mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.7 informe ${ano}`) });
  await item.getByRole("button", { name: "Enviar" }).click();
  await expect(p2.getByText("Recebido. Pode enviar outro arquivo").first()).toBeVisible();
  await anon.close();

  await page.reload();
  await expect(page.locator("tr", { hasText: "Informes de rendimentos do trabalho" }).locator(".selo", { hasText: "Recebido" })).toBeVisible();
  await expect(page.getByText("Contribuinte enviou pelo link")).toBeVisible();

  // Simulação (ano sem tabela: aviso)
  await expect(page.getByText(`Não há tabela de ${ano}`)).toBeVisible();
});
