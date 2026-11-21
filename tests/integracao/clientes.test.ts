import { describe, expect, it } from "vitest";
import { comEscritorio, prisma } from "@/lib/db";
import { adicionarVinculo, alterarSituacao, criarCliente, criarContrato, listarClientes, marcarItemChecklist, obterClienteVisivel, reajustarHonorario } from "@/lib/clientes";
import { cnpjFicticio, novoEscritorio, temBanco } from "./ajuda";

describe.skipIf(!temBanco)("clientes (banco real)", () => {
  it("cria cliente com código sequencial, checklist e linha do tempo", async () => {
    const e = await novoEscritorio();
    const r = await comEscritorio(e.ctx(e.admin), async (tx) => {
      const a = await criarCliente(tx, e.autor(e.admin), { pessoa: { tipo: "PJ", documento: cnpjFicticio(), nome: "Empresa A" }, inicioServico: "01/01/2026" });
      const b = await criarCliente(tx, e.autor(e.admin), { pessoa: { tipo: "PJ", documento: cnpjFicticio(), nome: "Empresa B" }, inicioServico: "01/01/2026" });
      if (!a.ok || !b.ok) throw new Error("falhou");
      const itens = await tx.itemChecklistEntrada.count({ where: { clienteId: a.cliente.id } });
      const eventos = await tx.eventoCliente.count({ where: { clienteId: a.cliente.id } });
      return { a: a.cliente.codigo, b: b.cliente.codigo, itens, eventos };
    });
    expect([r.a, r.b]).toEqual([1, 2]);
    expect(r.itens).toBe(7);
    expect(r.eventos).toBe(1);
  });

  it("não deixa cadastrar o mesmo CNPJ duas vezes e explica qual cliente já tem", async () => {
    const e = await novoEscritorio();
    const cnpj = cnpjFicticio();
    const r = await comEscritorio(e.ctx(e.admin), async (tx) => {
      await criarCliente(tx, e.autor(e.admin), { pessoa: { tipo: "PJ", documento: cnpj, nome: "Primeira" }, inicioServico: "2026-01-01" });
      return criarCliente(tx, e.autor(e.admin), { pessoa: { tipo: "PJ", documento: cnpj, nome: "Segunda" }, inicioServico: "2026-01-01" });
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.documento).toMatch(/cliente 1 \(Primeira\)/);
  });

  it("o mesmo CNPJ pode ser cliente em escritórios diferentes, sem um ver o outro", async () => {
    const e1 = await novoEscritorio();
    const e2 = await novoEscritorio();
    const cnpj = cnpjFicticio();
    for (const e of [e1, e2]) {
      const r = await comEscritorio(e.ctx(e.admin), (tx) => criarCliente(tx, e.autor(e.admin), { pessoa: { tipo: "PJ", documento: cnpj, nome: "Compartilhada" }, inicioServico: "2026-01-01" }));
      expect(r.ok).toBe(true);
    }
    const vistos = await comEscritorio(e1.ctx(e1.admin), (tx) => tx.cliente.count());
    expect(vistos).toBe(1);
    // Sem contexto de escritório, o banco não devolve nada.
    expect(await prisma.cliente.count()).toBe(0);
  });

  it("analista só enxerga clientes da própria carteira", async () => {
    const e = await novoEscritorio();
    const ids = await comEscritorio(e.ctx(e.admin), async (tx) => {
      const cart = await tx.carteira.create({ data: { escritorioId: e.escritorioId, nome: "BPO", responsavelId: e.bpo.id } });
      const a = await criarCliente(tx, e.autor(e.admin), { pessoa: { tipo: "PJ", documento: cnpjFicticio(), nome: "Na carteira" }, inicioServico: "2026-01-01", carteiraIds: [cart.id] });
      const b = await criarCliente(tx, e.autor(e.admin), { pessoa: { tipo: "PJ", documento: cnpjFicticio(), nome: "Fora da carteira" }, inicioServico: "2026-01-01" });
      if (!a.ok || !b.ok) throw new Error("falhou");
      return { a: a.cliente.id, b: b.cliente.id };
    });
    const doBpo = await comEscritorio(e.ctx(e.bpo), (tx) => listarClientes(tx, e.autor(e.bpo)));
    expect(doBpo.map((c) => c.pessoa.nome)).toEqual(["Na carteira"]);
    const outro = await comEscritorio(e.ctx(e.outroBpo), (tx) => listarClientes(tx, e.autor(e.outroBpo)));
    expect(outro).toHaveLength(0);
    expect(await comEscritorio(e.ctx(e.bpo), (tx) => obterClienteVisivel(tx, e.autor(e.bpo), ids.b))).toBeNull();
    const doContador = await comEscritorio(e.ctx(e.contador), (tx) => listarClientes(tx, e.autor(e.contador)));
    expect(doContador).toHaveLength(2);
  });

  it("busca por nome, código e CNPJ completo (pelo índice cego)", async () => {
    const e = await novoEscritorio();
    const cnpj = cnpjFicticio();
    await comEscritorio(e.ctx(e.admin), (tx) => criarCliente(tx, e.autor(e.admin), { pessoa: { tipo: "PJ", documento: cnpj, nome: "Padaria Estrela" }, inicioServico: "2026-01-01" }));
    for (const busca of ["estrela", "1", cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")]) {
      const r = await comEscritorio(e.ctx(e.admin), (tx) => listarClientes(tx, e.autor(e.admin), { busca }));
      expect(r.map((c) => c.pessoa.nome), busca).toEqual(["Padaria Estrela"]);
    }
  });

  it("só ativa o cliente com o checklist de entrada concluído", async () => {
    const e = await novoEscritorio();
    await comEscritorio(e.ctx(e.admin), async (tx) => {
      const r = await criarCliente(tx, e.autor(e.admin), { pessoa: { tipo: "PJ", documento: cnpjFicticio(), nome: "Nova" }, inicioServico: "2026-01-01" });
      if (!r.ok) throw new Error();
      await expect(alterarSituacao(tx, e.autor(e.admin), r.cliente.id, "ATIVO")).rejects.toThrow(/7 item/);
      for (const i of await tx.itemChecklistEntrada.findMany({ where: { clienteId: r.cliente.id } })) await marcarItemChecklist(tx, e.autor(e.admin), r.cliente.id, i.id, true);
      await alterarSituacao(tx, e.autor(e.admin), r.cliente.id, "ATIVO");
      expect((await tx.cliente.findUniqueOrThrow({ where: { id: r.cliente.id } })).situacao).toBe("ATIVO");
    });
  });

  it("sócios: soma das participações não passa de 100% e o sócio PF é reaproveitado", async () => {
    const e = await novoEscritorio();
    await comEscritorio(e.ctx(e.admin), async (tx) => {
      const pj1 = await criarCliente(tx, e.autor(e.admin), { pessoa: { tipo: "PJ", documento: cnpjFicticio(), nome: "PJ 1" }, inicioServico: "2026-01-01" });
      const pj2 = await criarCliente(tx, e.autor(e.admin), { pessoa: { tipo: "PJ", documento: cnpjFicticio(), nome: "PJ 2" }, inicioServico: "2026-01-01" });
      if (!pj1.ok || !pj2.ok) throw new Error();
      await adicionarVinculo(tx, e.autor(e.admin), pj1.cliente.id, { documento: "529.982.247-25", nome: "Maria", tipo: "SOCIO", participacao: "70", inicio: "2020-01-01" });
      await expect(
        adicionarVinculo(tx, e.autor(e.admin), pj1.cliente.id, { documento: "111.444.777-35", nome: "João", tipo: "SOCIO", participacao: "30,01", inicio: "2020-01-01" }),
      ).rejects.toThrow(/100,01%/);
      await expect(
        adicionarVinculo(tx, e.autor(e.admin), pj1.cliente.id, { documento: "529.982.247-25", nome: "", tipo: "ADMINISTRADOR", participacao: "", inicio: "2020-01-01" }),
      ).rejects.toThrow(/vínculo ativo/);
      // A mesma PF em outra empresa: não duplica a pessoa.
      await adicionarVinculo(tx, e.autor(e.admin), pj2.cliente.id, { documento: "52998224725", nome: "", tipo: "SOCIO", participacao: "10", inicio: "2021-01-01" });
      expect(await tx.pessoa.count({ where: { tipo: "PF" } })).toBe(1);
    });
  });

  it("honorários: reajuste vira nova linha, nunca sobrescreve", async () => {
    const e = await novoEscritorio();
    const valores = await comEscritorio(e.ctx(e.admin), async (tx) => {
      const r = await criarCliente(tx, e.autor(e.admin), { pessoa: { tipo: "PJ", documento: cnpjFicticio(), nome: "Cliente" }, inicioServico: "2026-01-01" });
      if (!r.ok) throw new Error();
      const c = await criarContrato(tx, e.autor(e.admin), r.cliente.id, { servicos: ["CONTABIL"], inicio: "2026-01-01", diaVencimento: 10, valor: "1.000,00" });
      await reajustarHonorario(tx, e.autor(e.admin), r.cliente.id, { contratoId: c.id, valor: "1.050,00", vigencia: "2027-01-01", motivo: "Reajuste anual" });
      await expect(reajustarHonorario(tx, e.autor(e.admin), r.cliente.id, { contratoId: c.id, valor: "900,00", vigencia: "2026-06-01", motivo: "x" })).rejects.toThrow(/posterior/);
      return tx.valorHonorario.findMany({ where: { contratoId: c.id }, orderBy: { vigenciaInicio: "asc" } });
    });
    expect(valores.map((v) => v.valorCentavos)).toEqual([100000n, 105000n]);
  });

  it("toda alteração em cliente fica na auditoria com o autor", async () => {
    const e = await novoEscritorio();
    const regs = await comEscritorio(e.ctx(e.admin), async (tx) => {
      await criarCliente(tx, e.autor(e.admin), { pessoa: { tipo: "PJ", documento: cnpjFicticio(), nome: "Auditada" }, inicioServico: "2026-01-01" });
      return tx.registroAuditoria.findMany({ where: { tabela: { in: ["pessoa", "cliente"] } } });
    });
    expect(regs.length).toBeGreaterThanOrEqual(2);
    expect(regs.every((r) => r.usuarioId === e.admin.id)).toBe(true);
    // O documento cifrado não vai para a auditoria.
    expect(JSON.stringify(regs.map((r) => [r.antes, r.depois]))).not.toContain("documento_cifrado");
  });
});
