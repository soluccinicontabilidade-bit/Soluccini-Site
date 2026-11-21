import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Pencil } from "lucide-react";
import { exigirAcesso } from "@/lib/auth/sessao";
import { pode } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { formatarData, formatarInstante, formatarReais, isoData, hojeSaoPaulo } from "@/lib/br";
import { isoCompetencia, NOME_ORIGEM, NOME_SITUACAO_PERIODO, ORIGENS_EDITAVEIS } from "@/lib/contabil/lancamentos";
import { clienteOu404 } from "@/lib/contabil/pagina";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Selo } from "@/components/Selo";
import { acaoEstornar } from "../../../acoes";

export const metadata: Metadata = { title: "Lançamento" };

export default async function Lancamento({ params, searchParams }: { params: Promise<{ clienteId: string; lancamentoId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { clienteId, lancamentoId } = await params;
  const sp = await searchParams;
  const acesso = await exigirAcesso("contabil.ver");
  if (!/^[0-9a-f-]{36}$/i.test(lancamentoId)) notFound();
  const d = await comEscritorio(acesso.ctx, async (tx) => {
    const cliente = await clienteOu404(tx, acesso, clienteId);
    const l = await tx.lancamentoContabil.findFirst({
      where: { id: lancamentoId, clienteId },
      include: {
        partidas: { include: { conta: true }, orderBy: { ordem: "asc" } }, periodo: true,
        estorna: { select: { id: true, numero: true } }, estornadoPor: { select: { id: true, numero: true } },
      },
    });
    const autor = l ? await tx.usuario.findUnique({ where: { id: l.criadoPorId }, select: { nome: true } }) : null;
    return { cliente, l, autor };
  });
  if (!d.l) notFound();
  const l = d.l;
  const soma = (t: "DEBITO" | "CREDITO") => l.partidas.filter((p) => p.tipo === t).reduce((s, p) => s + p.valorCentavos, 0n);
  const aberto = l.periodo.situacao === "ABERTO";
  const podeLancar = pode(acesso.usuario.perfil, "contabil.lancar");
  const editavel = podeLancar && aberto && ORIGENS_EDITAVEIS.includes(l.origem) && !l.estornadoPor;
  const estornavel = podeLancar && l.origem !== "ESTORNO" && !l.estornadoPor;
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <span className="trilha"><Link href="/contabilidade">Contabilidade</Link> / <Link href={`/contabilidade/${clienteId}?mes=${isoCompetencia(l.periodo.competencia)}`}>{d.cliente.pessoa.nome}</Link> / Lançamento</span>
          <h1>Lançamento nº {l.numero}</h1>
          <div className="linha">
            <span className="etiqueta">{NOME_ORIGEM[l.origem]}</span>
            <Selo tom={aberto ? "positivo" : "neutro"}>Período {NOME_SITUACAO_PERIODO[l.periodo.situacao].toLowerCase()}</Selo>
            {l.estornadoPor && <Selo tom="neutro">Estornado pelo <Link href={`/contabilidade/${clienteId}/lancamentos/${l.estornadoPor.id}`}>nº {l.estornadoPor.numero}</Link></Selo>}
            {l.estorna && <Selo tom="neutro">Estorna o <Link href={`/contabilidade/${clienteId}/lancamentos/${l.estorna.id}`}>nº {l.estorna.numero}</Link></Selo>}
          </div>
        </div>
        {editavel && <Link className="botao secundario" href={`/contabilidade/${clienteId}/lancamentos/${l.id}/editar`}><Pencil size={16} aria-hidden /> Editar</Link>}
      </div>
      {sp.salvo && <div className="aviso positivo" role="status"><Check size={20} aria-hidden /> Alterações salvas.</div>}
      {sp.estorno && <div className="aviso positivo" role="status"><Check size={20} aria-hidden /> Estorno registrado.</div>}

      <section className="cartao pilha">
        <dl className="definicoes">
          <div><dt>Data</dt><dd>{formatarData(l.data)}</dd></div>
          <div><dt>Registrado</dt><dd>{formatarInstante(l.criadoEm)} por {d.autor?.nome ?? "Sistema"}</dd></div>
          <div style={{ gridColumn: "1 / -1" }}><dt>Histórico</dt><dd>{l.historico}</dd></div>
          {l.justificativa && <div style={{ gridColumn: "1 / -1" }}><dt>Justificativa</dt><dd>{l.justificativa}</dd></div>}
        </dl>
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Conta</th><th>Complemento</th><th className="num">Débito</th><th className="num">Crédito</th></tr></thead>
            <tbody>
              {l.partidas.map((p) => (
                <tr key={p.id}>
                  <td>{p.conta.codigo} {p.conta.nome}</td>
                  <td className="pequeno">{p.historicoComplementar}</td>
                  <td className="num">{p.tipo === "DEBITO" ? formatarReais(p.valorCentavos) : ""}</td>
                  <td className="num">{p.tipo === "CREDITO" ? formatarReais(p.valorCentavos) : ""}</td>
                </tr>
              ))}
              <tr className="linha-total"><td colSpan={2}><strong>Totais</strong></td><td className="num"><strong>{formatarReais(soma("DEBITO"))}</strong></td><td className="num"><strong>{formatarReais(soma("CREDITO"))}</strong></td></tr>
            </tbody>
          </table>
        </div>
      </section>

      {estornavel && (
        <details className="painel-form">
          <summary>Estornar este lançamento</summary>
          <div>
            <p className="pequeno" style={{ marginBottom: 12 }}>O estorno cria um novo lançamento com as partidas invertidas. O original continua no histórico. A data precisa estar num mês aberto.</p>
            <Formulario acao={acaoEstornar.bind(null, clienteId, l.id)} className="campos campos-2" confirmar={`Estornar o lançamento nº ${l.numero}?`}>
              <Campo nome="data" rotulo="Data do estorno" tipo="date" valor={aberto ? isoData(l.data) : isoData(hojeSaoPaulo())} obrigatorio />
              <Campo nome="justificativa" rotulo="Justificativa" obrigatorio placeholder="Ex.: lançado em duplicidade" />
              <div className="ocupa-tudo"><BotaoEnviar className="perigo">Estornar</BotaoEnviar></div>
            </Formulario>
          </div>
        </details>
      )}
    </div>
  );
}
