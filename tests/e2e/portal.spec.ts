import { expect, test } from "@playwright/test";
import { authenticator } from "otplib";
import { codigoNovo } from "./util";

const SENHA = process.env.E2E_SENHA_PORTAL ?? "";
let segredo = process.env.E2E_TOTP_PORTAL ?? "";

test("portal: cliente entra, aprova pagamento e baixa relatório de mês fechado", async ({ page }) => {
  test.skip(!SENHA, "Defina E2E_SENHA_PORTAL");
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill("mariana@portal.local");
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/entrar\/(ativar-2fa|verificacao)/);
  if (page.url().includes("ativar-2fa")) {
    await page.getByText("Não consegue ler o QR code?").click();
    segredo = (await page.locator(".segredo").innerText()).trim();
    console.log(`Segredo 2FA do portal: ${segredo}`);
    await page.getByLabel("Código de 6 dígitos").fill(authenticator.generate(segredo));
    await page.getByRole("button", { name: "Ativar" }).click();
    await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  } else {
    await page.getByLabel("Código").fill(await codigoNovo("mariana@portal.local", segredo));
    await page.getByRole("button", { name: "Confirmar" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "Padaria Pão Quente Ltda" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Contabilidade" })).toHaveCount(0); // nada da área interna

  await page.getByRole("navigation", { name: "Seções do portal" }).getByRole("link", { name: /Pagamentos/ }).click();
  const prolabore = page.locator(".partida-linha", { hasText: "Pró-labore Mariana" });
  if (await prolabore.count()) {
    await prolabore.getByRole("button", { name: "Aprovar" }).click();
    await expect(page.getByText("Nada para aprovar agora.")).toBeVisible();
  }

  await page.getByRole("navigation", { name: "Seções do portal" }).getByRole("link", { name: "Relatórios" }).click();
  await expect(page.getByText("01/2026")).toBeVisible();
  const dl = page.waitForEvent("download");
  await page.locator("div.linha", { hasText: "01/2026" }).getByRole("link", { name: "Resultado (DRE)" }).click();
  expect((await dl).suggestedFilename()).toBe("dre-2026-01.pdf");

  // Área interna bloqueada para o cliente
  await page.goto("/clientes");
  await expect(page).toHaveURL(/\/portal/);
});
