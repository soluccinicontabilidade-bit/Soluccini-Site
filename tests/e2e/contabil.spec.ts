import { expect, test, type Page } from "@playwright/test";
import { authenticator } from "otplib";

// Usa o banco de demonstração (npm run db:seed): padaria com jan fechado e fev em conferência.
const SENHA_ADMIN = process.env.E2E_SENHA ?? "";
const SENHA_EQUIPE = process.env.E2E_SENHA_EQUIPE ?? "";
const segredos: Record<string, string> = {
  "admin@soluccini.local": process.env.E2E_TOTP ?? "",
  "contadora@soluccini.local": process.env.E2E_TOTP_CONTADORA ?? "",
};

async function entrar(page: Page, email: string, senha: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/entrar\/(ativar-2fa|verificacao)/);
  if (page.url().includes("ativar-2fa")) {
    await page.getByText("Não consegue ler o QR code?").click();
    segredos[email] = (await page.locator(".segredo").innerText()).trim();
    console.log(`Segredo 2FA de ${email}: ${segredos[email]}`);
    await page.getByLabel("Código de 6 dígitos").fill(authenticator.generate(segredos[email]));
    await page.getByRole("button", { name: "Ativar" }).click();
    await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  } else {
    await page.getByLabel("Código").fill(authenticator.generate(segredos[email]));
    await page.getByRole("button", { name: "Confirmar" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: /Olá/ })).toBeVisible();
}

test("contabilidade: lançar, estornar, relatórios e exportação", async ({ page }) => {
  test.skip(!SENHA_ADMIN, "Defina E2E_SENHA");
  await entrar(page, "admin@soluccini.local", SENHA_ADMIN);
  await page.getByRole("link", { name: "Contabilidade" }).first().click();
  await page.getByRole("link", { name: "Padaria Pão Quente Ltda" }).click();
  await page.waitForURL(/\/contabilidade\/[0-9a-f-]{36}/);
  await page.goto(page.url().replace(/\?.*/, "") + "?mes=2026-03");
  await expect(page.getByText("Vendas do mês 03/2026 (cartão e dinheiro)")).toBeVisible();

  // Lançamento desequilibrado é recusado com a diferença; o formulário mantém o que foi digitado.
  await page.getByRole("link", { name: "Novo lançamento" }).click();
  await page.getByLabel("Data").fill("2026-03-15");
  await page.getByLabel("Histórico").fill("Conta de energia de março (E2E)");
  await page.locator("#p-conta-0").fill("5.1.2.02 - Energia elétrica");
  await page.locator("#p-valor-0").fill("412,37");
  await page.locator("#p-conta-1").fill("1.1.1.02 - Bancos conta movimento");
  await page.locator("#p-valor-1").fill("412,30");
  await expect(page.getByText("Diferença R$ 0,07")).toBeVisible();
  await page.getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(page.locator(".aviso.erro")).toContainText("Diferença: R$ 0,07");
  await expect(page.locator("#p-valor-0")).toHaveValue("412,37");
  await page.locator("#p-valor-1").fill("412,37");
  await expect(page.getByText("Fechado", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(page.getByText(/Lançamento nº \d+ registrado/)).toBeVisible();

  // Estorno
  await page.getByRole("link", { name: "Conta de energia de março (E2E)", exact: true }).last().click();
  await page.getByText("Estornar este lançamento").click();
  await page.getByLabel("Justificativa").fill("Teste de estorno E2E");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Estornar" }).click();
  await expect(page.getByText("Estorno registrado.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Lançamento nº \d+/);

  // Mês fechado não aceita lançamento
  await page.goto(page.url().replace(/\/lancamentos.*/, "") + "?mes=2026-01");
  await expect(page.getByText("Este mês está fechado e não aceita lançamentos.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Novo lançamento" })).toHaveCount(0);

  // Relatórios
  await page.getByRole("link", { name: "Relatórios" }).click();
  await page.getByLabel("Relatório").selectOption("balancete");
  await page.getByLabel("De", { exact: true }).fill("2026-01-01");
  await page.getByLabel("Até", { exact: true }).fill("2026-03-31");
  await page.getByRole("button", { name: "Gerar relatório" }).click();
  await expect(page.getByRole("heading", { name: "Balancete de verificação" })).toBeVisible();
  await expect(page.locator(".aviso.erro")).toHaveCount(0); // fecha
  await page.getByLabel("Relatório").selectOption("balanco");
  await page.getByRole("button", { name: "Gerar relatório" }).click();
  await expect(page.getByText("Total do passivo e do patrimônio líquido")).toBeVisible();
  await expect(page.locator(".aviso.erro")).toHaveCount(0);
  await page.getByLabel("Relatório").selectOption("dre");
  await page.getByRole("button", { name: "Gerar relatório" }).click();
  await expect(page.getByText("Lucro do período")).toBeVisible();
  const pdf = page.waitForEvent("download");
  await page.getByRole("link", { name: "PDF" }).click();
  const arq = await pdf;
  expect(arq.suggestedFilename()).toBe("dre-2026-01-01-a-2026-03-31.pdf");
});

test("fechamento: contadora fecha fevereiro com justificativa do banco", async ({ page }) => {
  test.skip(!SENHA_EQUIPE, "Defina E2E_SENHA_EQUIPE");
  await entrar(page, "contadora@soluccini.local", SENHA_EQUIPE);
  await page.goto("/contabilidade");
  await page.getByRole("link", { name: "Padaria Pão Quente Ltda" }).click();
  await page.getByRole("link", { name: "Fechamento" }).click();
  const fev = page.locator("section", { has: page.getByRole("heading", { name: "02/2026" }) });
  await expect(fev.getByText("Em conferência", { exact: true })).toBeVisible();
  await fev.getByRole("button", { name: "Fechar 02/2026" }).click();
  // Campo obrigatório: o navegador bloqueia; preenchendo, fecha.
  await fev.getByLabel(/1.1.1.02 Bancos conta movimento/).fill("Saldo conferido com o extrato de fevereiro");
  await fev.getByLabel(/1.1.1.01 Caixa/).fill("Caixa contado");
  page.once("dialog", (d) => d.accept());
  await fev.getByRole("button", { name: "Fechar 02/2026" }).click();
  await expect(fev.getByText("Fechado", { exact: true })).toBeVisible();
  await expect(fev.getByText(/Bancos conta movimento .*: Saldo conferido com o extrato de fevereiro/).first()).toBeVisible();

  // Reabertura com justificativa e volta para conferência (deixa o banco como estava).
  await fev.getByText("Reabrir 02/2026").click();
  await fev.getByLabel("Motivo da reabertura").fill("Teste automático de reabertura");
  page.once("dialog", (d) => d.accept());
  await fev.getByRole("button", { name: "Reabrir" }).click();
  await expect(fev.getByText("Aberto", { exact: true })).toBeVisible();
  await fev.getByRole("button", { name: "Enviar para conferência" }).click();
  await expect(fev.getByText("Em conferência", { exact: true })).toBeVisible();
});
