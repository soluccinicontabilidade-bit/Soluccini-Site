import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { exigirAcesso } from "@/lib/auth/sessao";
import { pode } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { formatarInstante, hojeSaoPaulo } from "@/lib/br";
import { clienteOu404, autorDoAcesso } from "@/lib/contabil/pagina";
import { competenciaDe, isoCompetencia, lerCompetencia, rotuloCompetencia } from "@/lib/contabil/lancamentos";
import { rotinaDoMes } from "@/lib/financeiro/financeiro";
import { CabecalhoFinanceiro } from "@/components/financeiro/Cabecalho";
import { acaoChecklistBpo } from "../../acoes";

export const metadata: Metadata = { title: "Rotina do mês" };

export default async function Rotina({ params, searchParams }: { params: Promise<{ clienteId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { clienteId } = await params;
  const sp = await searchParams;
  const acesso = await exigirAcesso("financeiro.ver");
  let mes: Date;
  try {
    mes = sp.mes ? lerCompetencia(sp.mes) : competenciaDe(hojeSaoPaulo());
  } catch {
    redirect(`/financeiro/${clienteId}/rotina`);
  }
  const d = await comEscritorio(acesso.ctx, async (tx) => ({
    cliente: await clienteOu404(tx, acesso, clienteId),
    itens: await rotinaDoMes(tx, autorDoAcesso(acesso), clienteId, mes),
    usuarios: await tx.usuario.findMany({ select: { id: true, nome: true } }),
  }));
  const operar = pode(acesso.usuario.perfil, "financeiro.operar");
  const outro = (n: number) => isoCompetencia(new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() + n, 1)));
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <CabecalhoFinanceiro clienteId={clienteId} nome={d.cliente.pessoa.nome} codigo={d.cliente.codigo} atual="/rotina" />
      <div className="meses">
        <Link className="botao secundario pequeno" href={`/financeiro/${clienteId}/rotina?mes=${outro(-1)}`} aria-label="Mês anterior"><ChevronLeft size={18} aria-hidden /></Link>
        <strong>{rotuloCompetencia(mes)}</strong>
        <Link className="botao secundario pequeno" href={`/financeiro/${clienteId}/rotina?mes=${outro(1)}`} aria-label="Próximo mês"><ChevronRight size={18} aria-hidden /></Link>
      </div>
      <section className="cartao">
        <ul className="checklist">
          {d.itens.map((i) => (
            <li key={i.id} className={i.concluidoEm ? "feito" : ""}>
              <form action={acaoChecklistBpo.bind(null, clienteId, i.id, !i.concluidoEm)}>
                <button className="marca" type="submit" disabled={!operar} aria-pressed={!!i.concluidoEm}>
                  <span className="caixa" aria-hidden>{i.concluidoEm && <Check size={16} />}</span>
                  <span><span className="texto">{i.descricao}</span>{i.concluidoEm && <span className="suave pequeno" style={{ display: "block" }}>{formatarInstante(i.concluidoEm)} · {d.usuarios.find((u) => u.id === i.concluidoPorId)?.nome}</span>}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
