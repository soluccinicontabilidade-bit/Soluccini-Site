import type { Metadata } from "next";
import Link from "next/link";
import { exigirAcesso } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { BotaoEnviar, Formulario } from "@/components/Formulario";
import { acaoCriarModeloPadrao } from "../acoes";

export const metadata: Metadata = { title: "Modelos de plano de contas" };

export default async function Modelos() {
  const { ctx } = await exigirAcesso("contabil.plano");
  const modelos = await comEscritorio(ctx, (tx) => tx.planoDeContas.findMany({ where: { clienteId: null }, include: { _count: { select: { contas: true, copias: true } } }, orderBy: { nome: "asc" } }));
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <span className="trilha"><Link href="/contabilidade">Contabilidade</Link> / Modelos</span>
          <h1>Modelos de plano de contas</h1>
          <p className="suave">O modelo é copiado para cada cliente novo. Mudar o modelo não altera planos já copiados.</p>
        </div>
      </div>
      <div className="aviso atencao">O modelo padrão é um ponto de partida para pequenas empresas. Revise contas, naturezas e códigos referenciais da Receita Federal antes de usar.</div>
      {modelos.length === 0 ? (
        <section className="cartao pilha">
          <p>Nenhum modelo ainda.</p>
          <Formulario acao={async () => { "use server"; return acaoCriarModeloPadrao(); }}><BotaoEnviar>Criar modelo padrão</BotaoEnviar></Formulario>
        </section>
      ) : (
        <section className="cartao">
          <table>
            <thead><tr><th>Modelo</th><th className="num">Contas</th><th className="num">Clientes que copiaram</th></tr></thead>
            <tbody>
              {modelos.map((m) => <tr key={m.id}><td><Link href={`/contabilidade/modelos/${m.id}`}>{m.nome}</Link></td><td className="num">{m._count.contas}</td><td className="num">{m._count.copias}</td></tr>)}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
