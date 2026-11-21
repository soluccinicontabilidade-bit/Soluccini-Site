import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { exigirAcesso } from "@/lib/auth/sessao";
import { pode } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { formatarData, formatarReais, hojeSaoPaulo, isoData } from "@/lib/br";
import { clienteOu404 } from "@/lib/contabil/pagina";
import { exigeAprovacao, NOME_SITUACAO_PARCELA } from "@/lib/financeiro/financeiro";
import { CabecalhoFinanceiro } from "@/components/financeiro/Cabecalho";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Selo } from "@/components/Selo";
import { acaoBaixar, acaoEstornarBaixa, acaoPedirAprovacao } from "../acoes";

export const metadata: Metadata = { title: "Pagar e receber" };

const FILTROS = { abertas: "Em aberto", vencidas: "Vencidas", aprovacao: "Aguardando aprovação", baixadas: "Baixadas", todas: "Todas" } as const;

export default async function PagarReceber({ params, searchParams }: { params: Promise<{ clienteId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { clienteId } = await params;
  const sp = await searchParams;
  const acesso = await exigirAcesso("financeiro.ver");
  const hoje = hojeSaoPaulo();
  const filtro = (sp.ver && sp.ver in FILTROS ? sp.ver : "abertas") as keyof typeof FILTROS;
  const tipo = sp.tipo === "PAGAR" || sp.tipo === "RECEBER" ? sp.tipo : undefined;
  const where: Prisma.ParcelaWhereInput = { clienteId, titulo: { canceladoEm: null, ...(tipo ? { tipo } : {}) } };
  if (filtro === "abertas") where.situacao = { in: ["ABERTA", "AGUARDANDO_APROVACAO", "APROVADA", "REPROVADA"] };
  if (filtro === "vencidas") Object.assign(where, { situacao: { in: ["ABERTA", "APROVADA", "REPROVADA"] }, vencimento: { lt: hoje } });
  if (filtro === "aprovacao") where.situacao = "AGUARDANDO_APROVACAO";
  if (filtro === "baixadas") where.situacao = "BAIXADA";
  const d = await comEscritorio(acesso.ctx, async (tx) => ({
    cliente: await clienteOu404(tx, acesso, clienteId),
    parcelas: await tx.parcela.findMany({ where, include: { titulo: { include: { favorecido: true } } }, orderBy: filtro === "baixadas" ? { dataBaixa: "desc" } : { vencimento: "asc" }, take: 300 }),
    contas: await tx.contaBancaria.findMany({ where: { clienteId, ativa: true }, orderBy: { nome: "asc" } }),
    aprova: await exigeAprovacao(tx, clienteId),
  }));
  const operar = pode(acesso.usuario.perfil, "financeiro.operar");
  const total = (t: string) => d.parcelas.filter((p) => p.titulo.tipo === t).reduce((a, p) => a + p.valorCentavos, 0n);
  const podeAprovar = d.parcelas.filter((p) => p.titulo.tipo === "PAGAR" && (p.situacao === "ABERTA" || p.situacao === "REPROVADA"));
  const link = (o: Record<string, string | undefined>) => `/financeiro/${clienteId}?${new URLSearchParams(Object.entries({ ver: filtro, tipo, ...o }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="pilha" style={{ gap: 24 }}>
      <CabecalhoFinanceiro clienteId={clienteId} nome={d.cliente.pessoa.nome} codigo={d.cliente.codigo} atual=""
        acoes={operar ? <Link className="botao" href={`/financeiro/${clienteId}/novo`}><Plus size={18} aria-hidden /> Novo título</Link> : undefined} />
      {d.contas.length === 0 && <div className="aviso atencao">Cadastre uma conta bancária em <Link href={`/financeiro/${clienteId}/contas`}>Contas bancárias</Link> para registrar pagamentos e recebimentos.</div>}
      {d.aprova && <div className="aviso info">Este cliente aprova os pagamentos pelo portal: envie para aprovação antes de pagar.</div>}
      <div className="linha">
        {Object.entries(FILTROS).map(([k, v]) => <Link key={k} className={`botao pequeno ${k === filtro ? "" : "secundario"}`} href={link({ ver: k })}>{v}</Link>)}
        <span style={{ flex: 1 }} />
        <Link className={`botao pequeno ${!tipo ? "" : "secundario"}`} href={link({ tipo: undefined })}>Tudo</Link>
        <Link className={`botao pequeno ${tipo === "PAGAR" ? "" : "secundario"}`} href={link({ tipo: "PAGAR" })}>A pagar</Link>
        <Link className={`botao pequeno ${tipo === "RECEBER" ? "" : "secundario"}`} href={link({ tipo: "RECEBER" })}>A receber</Link>
      </div>
      <p className="pequeno suave tabular">{d.parcelas.length} parcela(s) · a receber {formatarReais(total("RECEBER"))} · a pagar {formatarReais(total("PAGAR"))}</p>

      <section className="cartao pilha">
        <div className="tabela-rolagem">
          <table>
            <thead><tr>{d.aprova && operar && <th><span className="leitor">Selecionar</span></th>}<th>Vencimento</th><th>Descrição</th><th>Situação</th><th className="num">Valor</th><th></th></tr></thead>
            <tbody>
              {d.parcelas.map((p) => {
                const vencida = p.situacao !== "BAIXADA" && p.vencimento < hoje;
                return (
                  <tr key={p.id}>
                    {d.aprova && operar && <td>{podeAprovar.includes(p) && <input type="checkbox" name="parcelas" value={p.id} form="form-aprovacao" aria-label={`Selecionar ${p.titulo.descricao}`} />}</td>}
                    <td className="tabular">{formatarData(p.vencimento)}{p.dataBaixa && <div className="suave pequeno">baixa {formatarData(p.dataBaixa)}</div>}</td>
                    <td>
                      <Link href={`/financeiro/${clienteId}/titulos/${p.tituloId}`}>{p.titulo.descricao}</Link>
                      <div className="suave pequeno">{p.titulo.tipo === "PAGAR" ? "A pagar" : "A receber"}{p.titulo.favorecido ? ` · ${p.titulo.favorecido.nome}` : ""}{p.total > 1 ? ` · parcela ${p.numero}/${p.total}` : ""}</div>
                    </td>
                    <td>
                      <Selo tom={p.situacao === "BAIXADA" ? "positivo" : vencida || p.situacao === "REPROVADA" ? "erro" : p.situacao === "AGUARDANDO_APROVACAO" ? "atencao" : "neutro"}>
                        {vencida && p.situacao !== "AGUARDANDO_APROVACAO" ? "Vencida" : NOME_SITUACAO_PARCELA[p.situacao]}
                      </Selo>
                      {p.motivoReprovacao && <div className="pequeno suave">{p.motivoReprovacao}</div>}
                    </td>
                    <td className="num">{formatarReais(p.valorCentavos)}{p.valorBaixaCentavos !== null && p.valorBaixaCentavos !== p.valorCentavos && <div className="suave pequeno">pago {formatarReais(p.valorBaixaCentavos)}</div>}</td>
                    <td>
                      {operar && p.situacao !== "BAIXADA" && p.situacao !== "CANCELADA" && d.contas.length > 0 && (!d.aprova || p.titulo.tipo === "RECEBER" || p.situacao === "APROVADA") && (
                        <details className="painel-form">
                          <summary>{p.titulo.tipo === "PAGAR" ? "Pagar" : "Receber"}</summary>
                          <div>
                            <Formulario acao={acaoBaixar.bind(null, clienteId, p.id)} className="campos">
                              <Campo nome="data" rotulo="Data" tipo="date" valor={isoData(p.vencimento < hoje ? hoje : p.vencimento)} obrigatorio />
                              <Campo nome="contaId" rotulo="Conta" valor={p.contaPrevistaId ?? d.contas[0].id} opcoes={d.contas.map((c) => ({ valor: c.id, rotulo: c.nome }))} />
                              <Campo nome="juros" rotulo="Juros" inputMode="decimal" placeholder="0,00" />
                              <Campo nome="multa" rotulo="Multa" inputMode="decimal" placeholder="0,00" />
                              <Campo nome="desconto" rotulo="Desconto" inputMode="decimal" placeholder="0,00" />
                              <BotaoEnviar className="pequeno">Registrar baixa</BotaoEnviar>
                            </Formulario>
                          </div>
                        </details>
                      )}
                      {operar && p.situacao === "BAIXADA" && !p.conciliacaoId && (
                        <Formulario acao={acaoEstornarBaixa.bind(null, clienteId, p.id)} confirmar="Estornar esta baixa?"><BotaoEnviar className="texto pequeno">Estornar baixa</BotaoEnviar></Formulario>
                      )}
                      {p.conciliacaoId && <span className="pequeno suave">Conciliada</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {d.parcelas.length === 0 && <p className="suave">Nada por aqui.</p>}
        {d.aprova && operar && podeAprovar.length > 0 && (
          <Formulario acao={acaoPedirAprovacao.bind(null, clienteId)} id="form-aprovacao">
            <BotaoEnviar className="secundario">Enviar selecionados para aprovação</BotaoEnviar>
          </Formulario>
        )}
      </section>
    </div>
  );
}
