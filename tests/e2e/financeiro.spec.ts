import { expect, test } from "@playwright/test";
import { entrarCom2fa } from "./util";
import path from "node:path";

const SENHA = process.env.E2E_SENHA ?? "";
const TOTP = process.env.E2E_TOTP ?? "";

test("financeiro: importa OFX, concilia automático, lança tarifa pela transação e vê relatório", async ({ page }) => {
  test.skip(!SENHA || !TOTP, "Defina E2E_SENHA e E2E_TOTP (admin com 2FA ativo)");
  await entrarCom2fa(page, "admin@soluccini.local", SENHA, TOTP);

  await page.getByRole("link", { name: "Financeiro (BPO)" }).first().click();
  await page.getByRole("link", { name: "Padaria Pão Quente Ltda" }).click();
  await expect(page.getByText("Aluguel da loja").first()).toBeVisible();
  await page.getByRole("link", { name: "Contas bancárias" }).click();
  await page.getByLabel("Extrato OFX de Itaú movimento").setInputFiles(path.join(__dirname, "../../exemplos/extrato-padaria-2026-04.ofx"));
  await page.getByRole("button", { name: "Importar extrato OFX" }).click();
  const jaImportado = page.getByText("Este mesmo arquivo já foi importado nesta conta.");
  const importado = page.getByText(/Extrato importado: 5 transação\(ões\) nova\(s\)/);
  await expect(jaImportado.or(importado)).toBeVisible();
  if (await jaImportado.isVisible()) {
    await page.goto(page.url().replace(/\/contas.*/, "/conciliacao?mes=2026-04"));
  } else {
    await expect(page.getByText(/4 conciliada\(s\) automaticamente/)).toBeVisible(); // aluguel, energia, Cielo, fornecedor
  }
  // Tarifa: lança direto da transação.
  const tarifa = page.locator(".partida-linha", { hasText: "TARIFA PACOTE SERVICOS" });
  if (await tarifa.getByText("Lançar ou ignorar").count()) {
    await tarifa.getByText("Lançar ou ignorar").click();
    await tarifa.getByLabel("Categoria", { exact: true }).selectOption({ label: "Tarifas bancárias" });
    await tarifa.getByRole("button", { name: "Lançar e conciliar" }).click();
  }
  await expect(tarifa.getByText("Conciliada")).toBeVisible();
  await expect(page.getByText("extrato e sistema iguais")).toBeVisible();

  await page.getByRole("link", { name: "Relatórios" }).click();
  await page.getByLabel("Relatório").selectOption("realizado");
  await page.getByLabel("De", { exact: true }).fill("2026-04-01");
  await page.getByLabel("Até", { exact: true }).fill("2026-04-30");
  await page.getByRole("button", { name: "Gerar relatório" }).click();
  await expect(page.getByText("Saldo final das contas")).toBeVisible();
  await expect(page.locator(".aviso.erro")).toHaveCount(0);
});
