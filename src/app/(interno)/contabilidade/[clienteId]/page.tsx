import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { exigirAcesso } from "@/lib/auth/sessao";
import { pode } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { formatarData, formatarReais, hojeSaoPaulo } from "@/lib/br";
import { competenciaDe, isoCompetencia, lerCompetencia, NOME_ORIGEM, NOME_SITUACAO_PERIODO, rotuloCompetencia } from "@/lib/contabil/lancamentos";
import { fimDoMes } from "@/lib/contabil/periodos";
import { clienteOu404 } from "@/lib/contabil/pagina";
import { CabecalhoContabil } from "@/components/contabil/Cabecalho";
import { Selo } from "@/components/Selo";

export const metadata: Metadata = { title: "Lançamentos" };

const TOM = { ABERTO: "positivo", EM_CONFERENCIA: "atencao", FECHADO: "neutro" } as const;

export default async function Lancamentos({ params, searchParams }: { params: Promise<{ clienteId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { clienteId } = await params;
  const sp = await searchParams;
  const acesso = await exigirAcesso("contabil.ver");
  let competencia: Date;
  try {
    competencia = sp.mes ? lerCompetencia(sp.mes) : competenciaDe(hojeSaoPaulo());
  } catch {
    redirect(`/contabilidade/${clienteId}`);
  }
  const d = await comEscritorio(acesso.ctx, async (tx) => {
    const cliente = await clienteOu404(tx, acesso, clienteId);
    const plano = await tx.planoDeContas.findUnique({ where: { clienteId }, select: { id: true } });
    const periodo = await tx.periodoContabil.findUnique({ where: { clienteId_competencia: { clienteId, competencia } } });
    const lancamentos = await tx.lancamentoContabil.findMany({
      where: { clienteId, excluidoEm: null, data: { gte: competencia, lte: fimDoMes(competencia) } },
      include: { partidas: { include: { conta: { select: { codigo: true, nome: true } } }, orderBy: { ordem: "asc" } }, estornadoPor: { select: { numero: true } } },
      orderBy: [{ data: "asc" }, { numero: "asc" }],
    });
    return { cliente, plano, periodo, lancamentos };
  });
  if (!d.plano) redirect(`/contabilidade/${clienteId}/plano`);
  const situacao = d.periodo?.situacao ?? "ABERTO";
  const anterior = new Date(Date.UTC(competencia.getUTCFullYear(), competencia.getUTCMonth() - 1, 1));
  const proximo = new Date(Date.UTC(competencia.getUTCFullYear(), competencia.getUTCMonth() + 1, 1));
  const total = d.lancamentos.reduce((s, l) => s + l.partidas.filter((p) => p.tipo === "DEBITO").reduce((t, p) => t + p.valorCentavos, 0n), 0n);
  const podeLancar = pode(acesso.usuario.perfil, "contabil.lancar") && situacao === "ABERTO";

  return (
    <div className="pilha" style={{ gap: 24 }}>
      <CabecalhoContabil clienteId={clienteId} nome={d.cliente.pessoa.nome} codigo={d.cliente.codigo} atual=""
        acoes={podeLancar ? <Link className="botao" href={`/contabilidade/${clienteId}/lancamentos/novo?data=${isoCompetencia(competencia)}-01`}><Plus size={18} aria-hidden /> Novo lançamento</Link> : undefined} />

      {sp.criado && <div className="aviso positivo" role="status"><Check size={20} aria-hidden /> Lançamento nº {sp.criado} registrado.</div>}

      <div className="linha" style={{ justifyContent: "space-between" }}>
        <div className="meses">
          <Link className="botao secundario pequeno" href={`/contabilidade/${clienteId}?mes=${isoCompetencia(anterior)}`} aria-label={`Mês anterior, ${rotuloCompetencia(anterior)}`}><ChevronLeft size={18} aria-hidden /></Link>
          <strong>{rotuloCompetencia(competencia)}</strong>
          <Link className="botao secundario pequeno" href={`/contabilidade/${clienteId}?mes=${isoCompetencia(proximo)}`} aria-label={`Próximo mês, ${rotuloCompetencia(proximo)}`}><ChevronRight size={18} aria-hidden /></Link>
          <Selo tom={TOM[situacao]}>{NOME_SITUACAO_PERIODO[situacao]}</Selo>
        </div>
        <span className="pequeno suave tabular">{d.lancamentos.length} lançamento(s) · movimento {formatarReais(total)}</span>
      </div>

      {situacao !== "ABERTO" && (
        <div className="aviso info">Este mês está {NOME_SITUACAO_PERIODO[situacao].toLowerCase()} e não aceita lançamentos. {pode(acesso.usuario.perfil, "contabil.conferencia") && <Link href={`/contabilidade/${clienteId}/fechamento`}>Ver fechamento</Link>}</div>
      )}

      {d.lancamentos.length === 0 ? (
        <div className="cartao vazio"><p>Nenhum lançamento em {rotuloCompetencia(competencia)}.</p></div>
      ) : (
        <section className="cartao">
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th className="num">Nº</th><th>Data</th><th>Histórico</th><th>Partidas</th><th className="num">Valor</th></tr></thead>
              <tbody>
                {d.lancamentos.map((l) => {
                  const valor = l.partidas.filter((p) => p.tipo === "DEBITO").reduce((t, p) => t + p.valorCentavos, 0n);
                  return (
                    <tr key={l.id}>
                      <td className="num"><Link href={`/contabilidade/${clienteId}/lancamentos/${l.id}`}>{l.numero}</Link></td>
                      <td className="tabular">{formatarData(l.data)}</td>
                      <td>
                        <Link href={`/contabilidade/${clienteId}/lancamentos/${l.id}`}>{l.historico}</Link>
                        <div className="linha" style={{ gap: 4, marginTop: 4 }}>
                          {l.origem !== "MANUAL" && <span className="etiqueta">{NOME_ORIGEM[l.origem]}</span>}
                          {l.estornadoPor && <Selo tom="neutro">Estornado pelo nº {l.estornadoPor.numero}</Selo>}
                        </div>
                      </td>
                      <td className="pequeno">
                        {l.partidas.map((p) => (
                          <div key={p.id}><span className="suave">{p.tipo === "DEBITO" ? "D" : "C"}</span> {p.conta.codigo} {p.conta.nome}</div>
                        ))}
                      </td>
                      <td className="num">{formatarReais(valor)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
