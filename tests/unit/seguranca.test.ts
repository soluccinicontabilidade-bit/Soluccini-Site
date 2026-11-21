import { describe, expect, it } from "vitest";
import { cifrar, decifrar, indiceCego } from "@/lib/cripto";
import { gerarSenhaTemporaria, problemaNaSenha } from "@/lib/auth/senha";
import { filtroClientes, pode } from "@/lib/auth/permissoes";
import { validarArquivo } from "@/lib/documentos";

describe("criptografia", () => {
  it("cifra e decifra; o mesmo texto gera cifras diferentes", () => {
    const a = cifrar("52998224725");
    const b = cifrar("52998224725");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(decifrar(a).toString()).toBe("52998224725");
  });
  it("detecta adulteração", () => {
    const a = cifrar("dado");
    a[a.length - 1] ^= 1;
    expect(() => decifrar(a)).toThrow();
  });
  it("índice cego é determinístico", () => {
    expect(indiceCego("123")).toBe(indiceCego("123"));
    expect(indiceCego("123")).not.toBe(indiceCego("124"));
  });
});

describe("senhas", () => {
  it("exige tamanho e variedade", () => {
    expect(problemaNaSenha("curta")).not.toBeNull();
    expect(problemaNaSenha("aaaaaaaaaaaaaa")).not.toBeNull();
    expect(problemaNaSenha("frase longa e segura 2026")).toBeNull();
  });
  it("senha temporária tem formato legível", () => {
    expect(gerarSenhaTemporaria()).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
  });
});

describe("perfis", () => {
  it("só administrador gerencia usuários e carteiras", () => {
    expect(pode("ADMINISTRADOR", "usuarios.gerenciar")).toBe(true);
    expect(pode("CONTADOR", "usuarios.gerenciar")).toBe(false);
    expect(pode("ANALISTA_BPO", "carteiras.gerenciar")).toBe(false);
  });
  it("cliente não entra na área interna", () => {
    expect(pode("CLIENTE_LEITOR", "area.interna")).toBe(false);
    expect(pode("CLIENTE_APROVADOR", "area.interna")).toBe(false);
    expect(pode("ANALISTA_IRPF", "area.interna")).toBe(true);
  });
  it("analista é filtrado pela carteira; contador vê tudo", () => {
    expect(JSON.stringify(filtroClientes({ id: "u1", perfil: "ANALISTA_BPO" }))).toContain("responsavelId");
    expect(JSON.stringify(filtroClientes({ id: "u1", perfil: "CONTADOR" }))).not.toContain("responsavelId");
    expect(JSON.stringify(filtroClientes({ id: "u1", perfil: "CLIENTE_LEITOR" }))).toContain("acessos");
  });
});

describe("arquivos enviados", () => {
  const pdf = Buffer.from("%PDF-1.7 conteúdo");
  it("aceita PDF verdadeiro", () => {
    expect(validarArquivo("contrato.pdf", "application/pdf", pdf)).toBeNull();
  });
  it("recusa extensão não permitida e conteúdo disfarçado", () => {
    expect(validarArquivo("script.exe", "application/octet-stream", pdf)).toMatch(/Formato/);
    expect(validarArquivo("falso.pdf", "application/pdf", Buffer.from("MZ executável"))).toMatch(/conteúdo/);
    expect(validarArquivo("vazio.pdf", "application/pdf", Buffer.alloc(0))).toMatch(/vazio/);
  });
});
