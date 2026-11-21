import type { Metadata } from "next";
import { FileDown } from "lucide-react";
import { exigirAcesso } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { hojeSaoPaulo, isoData } from "@/lib/br";
import { ErroDeNegocio } from "@/lib/erros";
import { clienteOu404 } from "@/lib/contabil/pagina";
import { lerPedidoFin, montarRelatorioFin } from "@/lib/financeiro/montar";
import { TIPOS_RELATORIO_FIN } from "@/lib/financeiro/relatorios";
import { CabecalhoFinanceiro } from "@/components/financeiro/Cabecalho";
import { TabelaRelatorio } from "@/components/contabil/TabelaRelatorio";

export const metadata: Metadata = { title: "Relatórios financeiros" };

export default async function RelatoriosFin({ params, searchParams }: { params: Promise<{ clienteId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { clienteId } = await params;
  const sp = await searchParams;
  const acesso = await exigirAcesso("financeiro.ver");
  const hoje = isoData(hojeSaoPaulo());
  const fimMes = isoData(new Date(Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7), 0)));
  const pedido = lerPedidoFin(sp, `${hoje.slice(0, 8)}01`, fimMes);
  const d = await comEscritorio(acesso.ctx, async (tx) => {
    const cliente = await clienteOu404(tx, acesso, clienteId);
    try {
      return { cliente, rel: await montarRelatorioFin(tx, clienteId, pedido), erro: "" };
    } catch (e) {
      if (e instanceof ErroDeNegocio) return { cliente, rel: null, erro: e.message };
      throw e;
    }
  });
  const q = new URLSearchParams({ tipo: pedido.tipo, de: pedido.de, ate: pedido.ate });
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <CabecalhoFinanceiro clienteId={clienteId} nome={d.cliente.pessoa.nome} codigo={d.cliente.codigo} atual="/relatorios" />
      <form className="cartao campos campos-3 filtros-relatorio">
        <div className="campo"><label htmlFor="tipo">Relatório</label><select id="tipo" name="tipo" defaultValue={pedido.tipo}>{Object.entries(TIPOS_RELATORIO_FIN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="campo"><label htmlFor="de">De</label><input id="de" name="de" type="date" defaultValue={pedido.de} /></div>
        <div className="campo"><label htmlFor="ate">Até</label><input id="ate" name="ate" type="date" defaultValue={pedido.ate} /></div>
        <div className="ocupa-tudo"><button className="botao" type="submit">Gerar relatório</button></div>
      </form>
      {d.erro && <div className="aviso erro" role="alert">{d.erro}</div>}
      {d.rel && (
        <section className="cartao pilha">
          <header>
            <div><h2>{d.rel.tabela.titulo}</h2><p className="suave pequeno">{d.cliente.pessoa.nome} · {d.rel.periodo}</p></div>
            <div className="linha exportar">{(["pdf", "xlsx", "csv"] as const).map((f) => <a key={f} className="botao secundario pequeno" href={`/financeiro/${clienteId}/relatorios/exportar?${q}&formato=${f}`}><FileDown size={16} aria-hidden /> {f.toUpperCase()}</a>)}</div>
          </header>
          <TabelaRelatorio tabela={d.rel.tabela} />
        </section>
      )}
    </div>
  );
}
