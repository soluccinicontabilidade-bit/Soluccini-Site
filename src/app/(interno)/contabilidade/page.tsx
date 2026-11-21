import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { exigirAcesso } from "@/lib/auth/sessao";
import { filtroClientes, pode } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { competenciaDe, isoCompetencia, rotuloCompetencia } from "@/lib/contabil/lancamentos";
import { hojeSaoPaulo } from "@/lib/br";
import { Selo } from "@/components/Selo";

export const metadata: Metadata = { title: "Contabilidade" };

export default async function Contabilidade() {
  const acesso = await exigirAcesso("contabil.ver");
  const { usuario, ctx } = acesso;
  const mesAtual = competenciaDe(hojeSaoPaulo());
  const clientes = await comEscritorio(ctx, (tx) =>
    tx.cliente.findMany({
      where: { AND: [filtroClientes(usuario), { situacao: { not: "ENCERRADO" } }] },
      include: {
        pessoa: { select: { nome: true } },
        planoDeContas: { select: { id: true } },
        periodos: { orderBy: { competencia: "asc" }, select: { competencia: true, situacao: true } },
      },
      orderBy: { pessoa: { nome: "asc" } },
    }),
  );
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <h1>Contabilidade</h1>
          <p className="suave">Lançamentos, relatórios e fechamento mensal por cliente.</p>
        </div>
        {pode(usuario.perfil, "contabil.plano") && <Link className="botao secundario" href="/contabilidade/modelos"><BookOpen size={18} aria-hidden /> Modelos de plano de contas</Link>}
      </div>
      <section className="cartao">
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Cliente</th><th>Último mês fechado</th><th>Pendências</th><th></th></tr></thead>
            <tbody>
              {clientes.map((c) => {
                const fechados = c.periodos.filter((p) => p.situacao === "FECHADO");
                const ultimo = fechados.at(-1);
                const conferencia = c.periodos.filter((p) => p.situacao === "EM_CONFERENCIA");
                const abertosAntigos = c.periodos.filter((p) => p.situacao === "ABERTO" && p.competencia < mesAtual);
                return (
                  <tr key={c.id}>
                    <td><Link href={`/contabilidade/${c.id}`}>{c.pessoa.nome}</Link><div className="suave pequeno">nº {c.codigo}</div></td>
                    <td>{ultimo ? rotuloCompetencia(ultimo.competencia) : <span className="suave">Nenhum</span>}</td>
                    <td>
                      <div className="linha" style={{ gap: 4 }}>
                        {!c.planoDeContas && <Selo tom="atencao">Sem plano de contas</Selo>}
                        {conferencia.length > 0 && <Selo tom="atencao">{conferencia.map((p) => rotuloCompetencia(p.competencia)).join(", ")} em conferência</Selo>}
                        {abertosAntigos.length > 0 && <Selo tom="erro">{abertosAntigos.length} mês(es) anterior(es) aberto(s)</Selo>}
                        {c.planoDeContas && !conferencia.length && !abertosAntigos.length && <Selo tom="positivo">Em dia</Selo>}
                      </div>
                    </td>
                    <td><Link className="botao secundario pequeno" href={c.planoDeContas ? `/contabilidade/${c.id}?mes=${isoCompetencia(mesAtual)}` : `/contabilidade/${c.id}/plano`}>Abrir</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {clientes.length === 0 && <p className="suave">Nenhum cliente disponível.</p>}
      </section>
    </div>
  );
}
