import type { Metadata } from "next";
import Link from "next/link";
import { exigirAcesso } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { acaoCriarCarteira } from "../equipe/acoes";

export const metadata: Metadata = { title: "Carteiras" };

export default async function Carteiras() {
  const { ctx } = await exigirAcesso("carteiras.gerenciar");
  const { carteiras, equipe } = await comEscritorio(ctx, async (tx) => ({
    carteiras: await tx.carteira.findMany({ include: { responsavel: { select: { nome: true } }, _count: { select: { clientes: true } } }, orderBy: { nome: "asc" } }),
    equipe: await tx.usuario.findMany({ where: { ativo: true, perfil: { in: ["ANALISTA_BPO", "ANALISTA_IRPF", "CONTADOR", "ADMINISTRADOR"] } }, orderBy: { nome: "asc" } }),
  }));
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <h1>Carteiras</h1>
          <p className="suave">Cada analista vê apenas os clientes das carteiras pelas quais responde. Um cliente pode estar em mais de uma carteira.</p>
        </div>
      </div>
      <section className="cartao">
        {carteiras.length === 0 ? <p className="suave">Nenhuma carteira criada.</p> : (
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Carteira</th><th>Responsável</th><th className="num">Clientes</th></tr></thead>
              <tbody>
                {carteiras.map((c) => (
                  <tr key={c.id}><td><Link href={`/carteiras/${c.id}`}>{c.nome}</Link></td><td>{c.responsavel.nome}</td><td className="num">{c._count.clientes}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="cartao">
        <h2>Nova carteira</h2>
        <Formulario acao={acaoCriarCarteira} className="campos campos-2" limparAoConcluir>
          <Campo nome="nome" rotulo="Nome" obrigatorio placeholder="BPO, IRPF, Contábil..." />
          <Campo nome="responsavelId" rotulo="Responsável" opcoes={[{ valor: "", rotulo: "Escolha" }, ...equipe.map((u) => ({ valor: u.id, rotulo: u.nome }))]} obrigatorio />
          <div className="ocupa-tudo"><BotaoEnviar>Criar carteira</BotaoEnviar></div>
        </Formulario>
      </section>
    </div>
  );
}
