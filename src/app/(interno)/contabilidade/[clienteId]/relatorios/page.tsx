import type { Metadata } from "next";
import { FileDown, Printer } from "lucide-react";
import { exigirAcesso } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { hojeSaoPaulo, isoData } from "@/lib/br";
import { ErroDeNegocio } from "@/lib/erros";
import { competenciaDe } from "@/lib/contabil/lancamentos";
import { fimDoMes } from "@/lib/contabil/periodos";
import { lerPedido, montarRelatorio, TIPOS_RELATORIO } from "@/lib/contabil/montar";
import { ordenarContas } from "@/lib/contabil/plano";
import { clienteOu404 } from "@/lib/contabil/pagina";
import { CabecalhoContabil } from "@/components/contabil/Cabecalho";
import { TabelaRelatorio } from "@/components/contabil/TabelaRelatorio";

export const metadata: Metadata = { title: "Relatórios" };

export default async function Relatorios({ params, searchParams }: { params: Promise<{ clienteId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { clienteId } = await params;
  const sp = await searchParams;
  const acesso = await exigirAcesso("contabil.ver");
  const mes = competenciaDe(hojeSaoPaulo());
  const pedido = lerPedido(sp, isoData(mes), isoData(fimDoMes(mes)));
  const d = await comEscritorio(acesso.ctx, async (tx) => {
    const cliente = await clienteOu404(tx, acesso, clienteId);
    const contas = ordenarContas(await tx.contaContabil.findMany({ where: { plano: { clienteId }, analitica: true }, select: { id: true, codigo: true, nome: true } }));
    let relatorio = null;
    let erro = "";
    try {
      relatorio = await montarRelatorio(tx, clienteId, pedido);
    } catch (e) {
      if (e instanceof ErroDeNegocio) erro = e.message;
      else throw e;
    }
    return { cliente, contas, relatorio, erro };
  });
  const consulta = new URLSearchParams(Object.entries({ tipo: pedido.tipo, de: pedido.de, ate: pedido.ate, nivel: String(pedido.nivel), conta: pedido.contaId ?? "" }).filter(([, v]) => v));
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <CabecalhoContabil clienteId={clienteId} nome={d.cliente.pessoa.nome} codigo={d.cliente.codigo} atual="/relatorios" />
      <form className="cartao campos campos-3 filtros-relatorio">
        <div className="campo">
          <label htmlFor="tipo">Relatório</label>
          <select id="tipo" name="tipo" defaultValue={pedido.tipo}>
            {Object.entries(TIPOS_RELATORIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="campo"><label htmlFor="de">De</label><input id="de" name="de" type="date" defaultValue={pedido.de} /></div>
        <div className="campo"><label htmlFor="ate">Até</label><input id="ate" name="ate" type="date" defaultValue={pedido.ate} /></div>
        <div className="campo">
          <label htmlFor="nivel">Detalhe (DRE e balanço)</label>
          <select id="nivel" name="nivel" defaultValue={String(pedido.nivel)}>
            <option value="2">Resumido (nível 2)</option><option value="3">Intermediário (nível 3)</option><option value="4">Completo</option>
          </select>
        </div>
        <div className="campo ocupa-2">
          <label htmlFor="conta">Conta (razão)</label>
          <select id="conta" name="conta" defaultValue={pedido.contaId ?? ""}>
            <option value="">Todas as contas com movimento</option>
            {d.contas.map((c) => <option key={c.id} value={c.id}>{c.codigo} {c.nome}</option>)}
          </select>
        </div>
        <div className="linha ocupa-tudo"><button className="botao" type="submit">Gerar relatório</button></div>
      </form>

      {d.erro && <div className="aviso erro" role="alert">{d.erro}</div>}
      {d.relatorio && (
        <section className="cartao pilha">
          <header>
            <div>
              <h2>{d.relatorio.tabela.titulo}</h2>
              <p className="suave pequeno">{d.cliente.pessoa.nome} · {d.relatorio.periodo}</p>
            </div>
            <div className="linha exportar">
              {(["pdf", "xlsx", "csv"] as const).map((f) => (
                <a key={f} className="botao secundario pequeno" href={`/contabilidade/${clienteId}/relatorios/exportar?${consulta}&formato=${f}`}><FileDown size={16} aria-hidden /> {f.toUpperCase()}</a>
              ))}
            </div>
          </header>
          <TabelaRelatorio tabela={d.relatorio.tabela} />
        </section>
      )}
      <p className="suave pequeno"><Printer size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> Para imprimir direto do navegador, use o atalho de impressão: os filtros e menus somem da folha.</p>
    </div>
  );
}
