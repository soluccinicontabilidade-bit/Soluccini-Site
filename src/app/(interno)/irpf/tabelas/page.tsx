import type { Metadata } from "next";
import Link from "next/link";
import { exigirAcesso } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { formatarInstante, isoData, hojeSaoPaulo } from "@/lib/br";
import { REFERENCIA_2026 } from "@/lib/irpf/calculo";
import { tabelaDoAno } from "@/lib/irpf/irpf";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Selo } from "@/components/Selo";
import { acaoTabela } from "../acoes";

export const metadata: Metadata = { title: "Tabelas do IRPF" };

export default async function Tabelas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { usuario, ctx } = await exigirAcesso("irpf.tabelas");
  const ano = Number(sp.ano) || hojeSaoPaulo().getUTCFullYear();
  const d = await comEscritorio(ctx, async (tx) => {
    await tabelaDoAno(tx, usuario.escritorioId, 2026);
    return {
      todas: await tx.tabelaIRPF.findMany({ orderBy: { anoCalendario: "desc" } }),
      atual: await tx.tabelaIRPF.findUnique({ where: { escritorioId_anoCalendario: { escritorioId: usuario.escritorioId, anoCalendario: ano } } }),
    };
  });
  const base = d.atual?.parametros ?? d.todas[0]?.parametros ?? REFERENCIA_2026;
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho"><div className="sobre"><span className="trilha"><Link href="/irpf">IRPF</Link> / Tabelas</span><h1>Tabelas do IRPF por ano-calendário</h1>
        <p className="suave">Faixas, deduções e limites ficam aqui, nunca fixos no código. Confira cada valor nas fontes oficiais da Receita Federal antes de marcar como confirmado.</p></div></div>
      <section className="cartao">
        <table><thead><tr><th>Ano-calendário</th><th>Situação</th><th>Fonte</th><th>Atualizada</th></tr></thead>
          <tbody>{d.todas.map((t) => <tr key={t.id}><td><Link href={`/irpf/tabelas?ano=${t.anoCalendario}`}>{t.anoCalendario}</Link></td><td><Selo tom={t.confirmada ? "positivo" : "atencao"}>{t.confirmada ? "Confirmada" : "A confirmar"}</Selo></td><td className="pequeno">{t.fonte}</td><td className="pequeno">{formatarInstante(t.atualizadoEm)}</td></tr>)}</tbody>
        </table>
      </section>
      <section className="cartao pilha">
        <h2>{d.atual ? `Editar ${ano}` : `Criar ${ano} (a partir da tabela mais recente)`}</h2>
        <form className="linha"><label htmlFor="ano-t" className="leitor">Ano</label><input id="ano-t" name="ano" type="number" defaultValue={ano} style={{ width: 110 }} /><button className="botao secundario pequeno" type="submit">Abrir ano</button></form>
        <p className="pequeno suave">Valores em centavos (R$ 2.275,08 = 227508). Alíquota em pontos-base (27,5% = 2750). Coeficiente do redutor em milionésimos (0,095575 = 95575). Faixa sem limite: &quot;ate&quot;: null.</p>
        <Formulario acao={acaoTabela.bind(null, ano)} className="campos">
          <div className="campo"><label htmlFor="parametros">Parâmetros (JSON)</label>
            <textarea id="parametros" name="parametros" rows={24} defaultValue={JSON.stringify(base, null, 2)} style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }} /></div>
          <Campo nome="fonte" rotulo="Fonte oficial" valor={d.atual?.fonte} ajuda="Ato normativo, link e data da consulta." />
          <Campo nome="prazoEntrega" rotulo="Prazo de entrega da declaração" tipo="date" valor={isoData(d.atual?.prazoEntrega)} />
          <Campo nome="confirmada" rotulo="Valores conferidos nas fontes oficiais?" valor={d.atual?.confirmada ? "sim" : "nao"} opcoes={[{ valor: "nao", rotulo: "Não, a confirmar" }, { valor: "sim", rotulo: "Sim, confirmados" }]} />
          <BotaoEnviar>Salvar tabela de {ano}</BotaoEnviar>
        </Formulario>
      </section>
    </div>
  );
}
