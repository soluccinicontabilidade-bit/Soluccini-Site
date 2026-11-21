import { expect, test, type Page } from "@playwright/test";
import { authenticator } from "otplib";
import { codigoNovo } from "./util";

const EMAIL = process.env.E2E_EMAIL ?? "admin@soluccini.local";
const SENHA = process.env.E2E_SENHA ?? "";

function cnpjAleatorio() {
  const b = String(Math.floor(10000000 + Math.random() * 89999999)) + "0001";
  const dv = (s: string, p: number[]) => { const r = p.reduce((a, x, i) => a + x * Number(s[i]), 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(b, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return b + d1 + dv(b + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
}

let segredo = process.env.E2E_TOTP ?? "";

async function entrar(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/entrar\/(ativar-2fa|verificacao)/);
  if (page.url().includes("ativar-2fa")) {
    await page.getByText("Não consegue ler o QR code?").click();
    segredo = (await page.locator(".segredo").innerText()).trim();
    await page.getByLabel("Código de 6 dígitos").fill(authenticator.generate(segredo));
    await page.getByRole("button", { name: "Ativar" }).click();
    await expect(page.getByRole("heading", { name: "Guarde seus códigos de recuperação" })).toBeVisible();
    await expect(page.locator(".codigos span")).toHaveCount(10);
    await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  } else {
    await page.getByLabel("Código").fill(await codigoNovo(EMAIL, segredo));
    await page.getByRole("button", { name: "Confirmar" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: /Olá/ })).toBeVisible();
}

test("fluxo da fase 1: entrar, cadastrar cliente, documento e importação", async ({ page }) => {
  test.skip(!SENHA, "Defina E2E_SENHA");
  await page.goto("/clientes");
  await expect(page).toHaveURL(/\/entrar$/); // sem sessão, vai para o login

  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill("senha errada demais");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator(".aviso.erro")).toHaveText(/não conferem/);
  await expect(page.getByLabel("E-mail")).toHaveValue(EMAIL); // não apaga o que foi digitado

  await entrar(page);

  // Cadastro de cliente com erro de validação e depois correto
  await page.getByRole("link", { name: "Cadastrar cliente" }).first().click();
  const cnpj = cnpjAleatorio();
  await page.getByRole("textbox", { name: "CNPJ" }).fill("11.111.111/1111-11");
  await page.getByLabel("Razão social").fill("Mercado Teste E2E Ltda");
  await page.getByLabel("Regime tributário").selectOption("SIMPLES_NACIONAL");
  await page.getByRole("button", { name: "Cadastrar cliente" }).click();
  await expect(page.getByText("CNPJ inválido. Confira os dígitos.")).toBeVisible();
  await expect(page.getByLabel("Razão social")).toHaveValue("Mercado Teste E2E Ltda");
  await page.getByRole("textbox", { name: "CNPJ" }).fill(cnpj);
  await page.getByRole("button", { name: "Cadastrar cliente" }).click();
  await expect(page.getByText(/Cliente cadastrado com o número \d+/)).toBeVisible();

  // Checklist de entrada
  const primeiro = page.locator(".checklist li").first();
  await primeiro.getByRole("button").click();
  await expect(primeiro).toHaveClass(/feito/);

  // Documento
  await page.getByRole("link", { name: "Documentos" }).click();
  await page.getByLabel("Categoria").selectOption({ label: "Contrato social e alterações" });
  await page.getByLabel("Arquivo").setInputFiles({ name: "contrato.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 contrato e2e " + cnpj) });
  await page.getByRole("button", { name: "Enviar documento" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Documento enviado." })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "v1" }).click();
  expect((await download).suggestedFilename()).toBe("contrato.pdf");

  // Histórico registra o download
  await page.getByRole("link", { name: "Histórico" }).click();
  await expect(page.getByText("Documento baixado: Contrato social e alterações (v1)")).toBeVisible();

  // Importação
  await page.goto("/importacoes");
  const outro = cnpjAleatorio();
  await page.getByLabel("Planilha").setInputFiles({
    name: "clientes-e2e.csv", mimeType: "text/csv",
    buffer: Buffer.from(`cpf_cnpj;nome;regime\n${outro};Importada E2E ${outro.slice(-6)};Presumido\n${cnpj};Mercado Teste E2E Ltda;Simples\n`),
  });
  await page.getByRole("button", { name: "Conferir planilha" }).click();
  await expect(page.getByRole("heading", { name: "Conferência da planilha" })).toBeVisible();
  await expect(page.getByText("Será cadastrado")).toBeVisible();
  await expect(page.getByText("Já é cliente. A linha será ignorada.")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Cadastrar 1 cliente(s)" }).click();
  await expect(page.getByText("Importação aplicada: 1 cliente(s) cadastrado(s).")).toBeVisible();

  await page.goto(`/clientes?busca=${outro}`);
  await expect(page.getByText(`Importada E2E ${outro.slice(-6)}`)).toBeVisible();
});
