import { describe, expect, it } from "vitest";
import { comEscritorio } from "@/lib/db";
import { ativarTotp, confirmarSegundoFator, entrarComSenha, lerSessao, MAX_TENTATIVAS, prepararTotp } from "@/lib/auth/login";
import { alterarUsuario, redefinirAcesso } from "@/lib/equipe";
import { codigoTotp, codigoTotpSeguinte, novoEscritorio, SENHA, temBanco } from "./ajuda";

describe.skipIf(!temBanco)("login e verificação em duas etapas (banco real)", () => {
  it("fluxo completo: senha, ativação do 2FA, novo login com código", async () => {
    const e = await novoEscritorio();
    const r1 = await entrarComSenha(e.contador.email.toUpperCase(), SENHA);
    expect(r1).toMatchObject({ ok: true, totpAtivo: false });
    if (!r1.ok) return;
    const s1 = (await lerSessao(r1.token))!;
    expect(s1.doisFatoresOk).toBe(false);
    const segredo = await prepararTotp(s1);
    expect(await ativarTotp(s1, "000000")).toMatchObject({ ok: false });
    const ativ = await ativarTotp(s1, codigoTotp(segredo));
    expect(ativ.ok).toBe(true);
    if (!ativ.ok) return;
    expect(ativ.codigos).toHaveLength(10);
    expect((await lerSessao(r1.token))!.doisFatoresOk).toBe(true);

    const r2 = await entrarComSenha(e.contador.email, SENHA);
    if (!r2.ok) throw new Error();
    expect(r2.totpAtivo).toBe(true);
    const s2 = (await lerSessao(r2.token))!;
    expect(s2.doisFatoresOk).toBe(false);
    // O código usado na ativação não vale de novo (proteção contra reuso).
    expect((await confirmarSegundoFator(s2, codigoTotp(segredo))).ok).toBe(false);
    expect(await confirmarSegundoFator(s2, codigoTotpSeguinte(segredo))).toEqual({ ok: true });

    // Código de recuperação vale uma única vez.
    const r3 = await entrarComSenha(e.contador.email, SENHA);
    if (!r3.ok) throw new Error();
    const s3 = (await lerSessao(r3.token))!;
    expect(await confirmarSegundoFator(s3, ativ.codigos[0].toUpperCase())).toEqual({ ok: true });
    const r4 = await entrarComSenha(e.contador.email, SENHA);
    if (!r4.ok) throw new Error();
    expect((await confirmarSegundoFator((await lerSessao(r4.token))!, ativ.codigos[0])).ok).toBe(false);
  });

  it("mensagem igual para e-mail inexistente e senha errada", async () => {
    const e = await novoEscritorio();
    const a = await entrarComSenha("ninguem@teste.local", SENHA);
    const b = await entrarComSenha(e.bpo.email, "senha errada qualquer");
    expect(a).toEqual(b);
  });

  it(`bloqueia depois de ${MAX_TENTATIVAS} senhas erradas, mesmo com a senha certa`, async () => {
    const e = await novoEscritorio();
    for (let i = 0; i < MAX_TENTATIVAS; i++) expect((await entrarComSenha(e.bpo.email, "errada errada")).ok).toBe(false);
    const r = await entrarComSenha(e.bpo.email, SENHA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensagem).toMatch(/bloqueado/);
  });

  it("usuário desativado perde as sessões abertas", async () => {
    const e = await novoEscritorio();
    const r = await entrarComSenha(e.bpo.email, SENHA);
    if (!r.ok) throw new Error();
    await comEscritorio(e.ctx(e.admin), (tx) => alterarUsuario(tx, e.autor(e.admin), e.bpo.id, { perfil: "ANALISTA_BPO", ativo: false }));
    expect(await lerSessao(r.token)).toBeNull();
    expect((await entrarComSenha(e.bpo.email, SENHA)).ok).toBe(false);
  });

  it("não deixa o escritório sem administrador", async () => {
    const e = await novoEscritorio();
    await expect(
      comEscritorio(e.ctx(e.admin), (tx) => alterarUsuario(tx, e.autor(e.admin), e.admin.id, { perfil: "CONTADOR", ativo: true })),
    ).rejects.toThrow(/administrador ativo/);
  });

  it("redefinir acesso troca a senha, zera o 2FA e derruba sessões", async () => {
    const e = await novoEscritorio();
    const r = await entrarComSenha(e.bpo.email, SENHA);
    if (!r.ok) throw new Error();
    const { senhaTemporaria } = await comEscritorio(e.ctx(e.admin), (tx) => redefinirAcesso(tx, e.autor(e.admin), e.bpo.id));
    expect(await lerSessao(r.token)).toBeNull();
    expect((await entrarComSenha(e.bpo.email, SENHA)).ok).toBe(false);
    expect(await entrarComSenha(e.bpo.email, senhaTemporaria)).toMatchObject({ ok: true, totpAtivo: false });
  });

  it("token de sessão inválido ou adulterado não abre nada", async () => {
    expect(await lerSessao("x".repeat(43))).toBeNull();
    expect(await lerSessao("")).toBeNull();
  });
});
