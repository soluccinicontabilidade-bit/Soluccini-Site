import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { exigirAcesso } from "@/lib/auth/sessao";
import { pode } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { formatarData, formatarInstante, formatarReais, hojeSaoPaulo } from "@/lib/br";
import { clienteOu404 } from "@/lib/contabil/pagina";
import { competenciaDe, isoCompetencia, lerCompetencia, rotuloCompetencia } from "@/lib/contabil/lancamentos";
import { divergencias, type Sugestao } from "@/lib/financeiro/conciliacao";
import { CabecalhoFinanceiro } from "@/components/financeiro/Cabecalho";
import { OpcoesCategorias } from "@/components/financeiro/SeletorCategoria";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Selo } from "@/components/Selo";
import {
  acaoAceitarSugestao, acaoAplicarRegras, acaoConciliar, acaoDesfazer, acaoFecharConciliacao, acaoIgnorar, acaoLancarDaTransacao,
  acaoReabrirConciliacao, acaoReativar, acaoSugerir,
} from "../../acoes";

export const metadata: Metadata = { title: "Conciliação" };

export default async function Conciliacao({ params, searchParams }: { params: Promise<{ clienteId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { clienteId } = await params;
  const sp = await searchParams;
  const acesso = await exigirAcesso("financeiro.ver");
  let mes: Date;
  try {
    mes = sp.mes ? lerCompetencia(sp.mes) : competenciaDe(hojeSaoPaulo());
  } catch {
    redirect(`/financeiro/${clienteId}/conciliacao`);
  }
  const fim = new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() + 1, 0));
  const d = await comEscritorio(acesso.ctx, async (tx) => {
    const cliente = await clienteOu404(tx, acesso, clienteId);
    const contas = await tx.contaBancaria.findMany({ where: { clienteId, ativa: true }, orderBy: { nome: "asc" } });
    const conta = contas.find((c) => c.id === sp.conta) ?? contas[0];
    if (!conta) return { cliente, contas, conta: null };
    const cfg = await tx.configFinanceira.findUnique({ where: { clienteId } });
    const tol = (cfg?.toleranciaDias ?? 3) * 86400_000;
    const transacoes = await tx.transacaoBancaria.findMany({ where: { contaBancariaId: conta.id, data: { gte: mes, lte: fim } }, orderBy: [{ data: "asc" }] });
    const baixas = await tx.parcela.findMany({ where: { contaBaixaId: conta.id, situacao: "BAIXADA", conciliacaoId: null, dataBaixa: { gte: new Date(mes.getTime() - tol), lte: new Date(fim.getTime() + tol) } }, include: { titulo: { include: { favorecido: true } } } });
    const abertas = await tx.parcela.findMany({
      where: { clienteId, situacao: { in: ["ABERTA", "APROVADA"] }, titulo: { canceladoEm: null }, vencimento: { gte: new Date(mes.getTime() - 31 * 86400_000), lte: new Date(fim.getTime() + tol) }, OR: [{ contaPrevistaId: conta.id }, { contaPrevistaId: null }] },
      include: { titulo: { include: { favorecido: true } } }, orderBy: { vencimento: "asc" },
    });
    const transf = await tx.transferencia.findMany({ where: { clienteId, canceladaEm: null, data: { gte: mes, lte: fim }, OR: [{ origemId: conta.id, conciliacaoOrigemId: null }, { destinoId: conta.id, conciliacaoDestinoId: null }] } });
    const fechamento = await tx.fechamentoConciliacao.findUnique({ where: { contaBancariaId_competencia: { contaBancariaId: conta.id, competencia: mes } } });
    const conciliacoes = await tx.conciliacao.findMany({ where: { contaBancariaId: conta.id, transacoes: { some: { data: { gte: mes, lte: fim } } } }, include: { transacoes: true, parcelas: { include: { titulo: true } } }, orderBy: { criadoEm: "desc" } });
    return {
      cliente, contas, conta, transacoes, baixas, abertas, transf, fechamento, conciliacoes, div: await divergencias(tx, conta.id, mes),
      categorias: await tx.categoriaFinanceira.findMany({ where: { clienteId }, orderBy: { ordem: "asc" } }),
    };
  });
  const operar = pode(acesso.usuario.perfil, "financeiro.operar");
  const base = (o: Record<string, string>) => `/financeiro/${clienteId}/conciliacao?${new URLSearchParams({ conta: d.conta?.id ?? "", mes: isoCompetencia(mes), ...o })}`;
  const anterior = isoCompetencia(new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() - 1, 1)));
  const proximo = isoCompetencia(new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() + 1, 1)));
  if (!d.conta) {
    return (
      <div className="pilha" style={{ gap: 24 }}>
        <CabecalhoFinanceiro clienteId={clienteId} nome={d.cliente.pessoa.nome} codigo={d.cliente.codigo} atual="/conciliacao" />
        <div className="aviso atencao">Cadastre uma conta em <Link href={`/financeiro/${clienteId}/contas`}>Contas bancárias</Link> e importe o extrato OFX.</div>
      </div>
    );
  }
  const fechado = !!d.fechamento?.fechado;
  const [novas, repetidas, auto] = (sp.importado ?? "").split("-");
  const abertasOuSugeridas = d.transacoes!.filter((t) => t.situacao === "PENDENTE" || t.situacao === "SUGERIDA");
  const livre = operar && !fechado;
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <CabecalhoFinanceiro clienteId={clienteId} nome={d.cliente.pessoa.nome} codigo={d.cliente.codigo} atual="/conciliacao" />
      {sp.importado && <div className="aviso positivo" role="status"><Check size={20} aria-hidden /> Extrato importado: {novas} transação(ões) nova(s), {repetidas} já existente(s), {auto} conciliada(s) automaticamente.</div>}
      <div className="linha" style={{ justifyContent: "space-between" }}>
        <div className="meses">
          <form className="linha">
            <input type="hidden" name="mes" value={isoCompetencia(mes)} />
            <label className="leitor" htmlFor="conta">Conta</label>
            <select id="conta" name="conta" defaultValue={d.conta.id}>{d.contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
            <button className="botao secundario pequeno" type="submit">Trocar</button>
          </form>
          <Link className="botao secundario pequeno" href={base({ mes: anterior })} aria-label="Mês anterior"><ChevronLeft size={18} aria-hidden /></Link>
          <strong>{rotuloCompetencia(mes)}</strong>
          <Link className="botao secundario pequeno" href={base({ mes: proximo })} aria-label="Próximo mês"><ChevronRight size={18} aria-hidden /></Link>
          <Selo tom={fechado ? "neutro" : "atencao"}>{fechado ? "Fechada" : "Aberta"}</Selo>
        </div>
        {livre && (
          <div className="linha">
            <Formulario acao={acaoSugerir.bind(null, clienteId, d.conta.id)}><BotaoEnviar className="secundario pequeno">Sugerir correspondências</BotaoEnviar></Formulario>
            <Formulario acao={acaoAplicarRegras.bind(null, clienteId, d.conta.id)} confirmar="Lançar e conciliar as transações que casam com regras aprendidas?"><BotaoEnviar className="secundario pequeno">Aplicar regras</BotaoEnviar></Formulario>
          </div>
        )}
      </div>

      <section className="grade grade-4">
        <div className="cartao indicador"><span className="rotulo">A conciliar</span><span className="valor">{abertasOuSugeridas.length}</span></div>
        <div className="cartao indicador"><span className="rotulo">Conciliadas</span><span className="valor">{d.transacoes!.filter((t) => t.situacao === "CONCILIADA").length}</span></div>
        <div className="cartao indicador"><span className="rotulo">Saldo no extrato{d.div!.dataSaldoExtrato ? ` (${formatarData(d.div!.dataSaldoExtrato)})` : ""}</span><span className="valor" style={{ fontSize: 20 }}>{d.div!.saldoExtrato !== null ? formatarReais(d.div!.saldoExtrato) : "—"}</span></div>
        <div className="cartao indicador"><span className="rotulo">Saldo no sistema</span><span className="valor" style={{ fontSize: 20 }}>{formatarReais(d.div!.saldoSistema)}</span>
          {d.div!.saldoExtrato !== null && d.div!.saldoExtrato !== d.div!.saldoSistema && <Selo tom="erro">Diferença {formatarReais(d.div!.saldoExtrato - d.div!.saldoSistema)}</Selo>}</div>
      </section>

      {livre && (
        <Formulario acao={acaoConciliar.bind(null, clienteId, d.conta.id)} id="form-conciliar" className="linha">
          <span className="pequeno">Marque transações do banco à esquerda e lançamentos do sistema à direita (pode ser vários de cada lado).</span>
          <select name="ajuste" aria-label="Diferença de valor"><option value="">Sem diferença</option><option value="juros">Diferença é juros/multa</option><option value="desconto">Diferença é desconto</option></select>
          <BotaoEnviar className="pequeno">Conciliar selecionados</BotaoEnviar>
        </Formulario>
      )}

      <div className="grade grade-2">
        <section className="cartao pilha">
          <h2>Extrato do banco</h2>
          {d.transacoes!.length === 0 && <p className="suave">Nenhuma transação neste mês. Importe o OFX em Contas bancárias.</p>}
          {d.transacoes!.map((t) => {
            const sug = (t.sugestao as unknown as Sugestao[] | null) ?? [];
            const pendente = t.situacao === "PENDENTE" || t.situacao === "SUGERIDA";
            return (
              <div key={t.id} className="partida-linha" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 8, background: t.situacao === "CONCILIADA" ? "var(--positivo-fundo)" : undefined }}>
                <div>{livre && pendente && <input type="checkbox" name="transacoes" value={t.id} form="form-conciliar" aria-label={`Selecionar ${t.descricao}`} />}</div>
                <div>
                  <div className="pequeno tabular suave">{formatarData(t.data)}</div>
                  <div>{t.descricao}</div>
                  {t.situacao === "CONCILIADA" && <Selo tom="positivo">Conciliada</Selo>}
                  {t.situacao === "IGNORADA" && <div><Selo tom="neutro">Ignorada</Selo> <span className="pequeno suave">{t.justificativa}</span>
                    {livre && <Formulario acao={acaoReativar.bind(null, clienteId, t.id)}><BotaoEnviar className="texto pequeno">Voltar a conciliar</BotaoEnviar></Formulario>}</div>}
                  {livre && t.situacao === "SUGERIDA" && sug.map((s) => (
                    <Formulario key={s.id} acao={acaoAceitarSugestao.bind(null, clienteId, d.conta!.id, t.id, s.tipo, s.id)} className="linha">
                      <span className="pequeno">Sugestão: {s.texto} <Selo tom={s.confianca >= 80 ? "positivo" : "atencao"}>confiança {s.confianca}</Selo>{!s.jaBaixada && <span className="suave"> (será baixada)</span>}</span>
                      <BotaoEnviar className="secundario pequeno">Aceitar</BotaoEnviar>
                    </Formulario>
                  ))}
                  {livre && pendente && (
                    <details className="painel-form" style={{ marginTop: 8 }}>
                      <summary>Lançar ou ignorar</summary>
                      <div className="pilha">
                        <Formulario acao={acaoLancarDaTransacao.bind(null, clienteId, t.id)} className="campos">
                          <div className="campo"><label htmlFor={`cat-${t.id}`}>Categoria</label><select id={`cat-${t.id}`} name="categoriaId" required><OpcoesCategorias categorias={d.categorias!} tipo={t.valorCentavos > 0n ? "RECEITA" : "DESPESA"} /></select></div>
                          <Campo nome="favorecido" rotulo="Fornecedor ou cliente" />
                          <label className="opcao"><input type="checkbox" name="criarRegra" value="sim" defaultChecked /> Usar esta categoria para as próximas transações com esta descrição</label>
                          <BotaoEnviar className="pequeno">Lançar e conciliar</BotaoEnviar>
                        </Formulario>
                        <Formulario acao={acaoIgnorar.bind(null, clienteId, t.id)} className="campos">
                          <Campo nome="justificativa" rotulo="Ignorar: por quê?" placeholder="Ex.: estorno do próprio banco no mesmo dia" />
                          <BotaoEnviar className="texto pequeno">Ignorar transação</BotaoEnviar>
                        </Formulario>
                      </div>
                    </details>
                  )}
                </div>
                <div className="num tabular" style={{ color: t.valorCentavos < 0n ? "var(--erro)" : "var(--positivo)" }}>{formatarReais(t.valorCentavos)}</div>
              </div>
            );
          })}
        </section>
        <section className="cartao pilha">
          <h2>No sistema</h2>
          {d.baixas!.length + d.abertas!.length + d.transf!.length === 0 && <p className="suave">Nada a conciliar no sistema.</p>}
          {d.baixas!.map((p) => (
            <label key={p.id} className="partida-linha" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 8 }}>
              {livre ? <input type="checkbox" name="parcelas" value={p.id} form="form-conciliar" /> : <span />}
              <span><span className="pequeno suave tabular">baixa {formatarData(p.dataBaixa!)}</span><br />{p.titulo.descricao}{p.titulo.favorecido ? ` · ${p.titulo.favorecido.nome}` : ""}</span>
              <span className="num tabular">{formatarReais((p.titulo.tipo === "RECEBER" ? 1n : -1n) * p.valorBaixaCentavos!)}</span>
            </label>
          ))}
          {d.transf!.map((t) => (
            <label key={t.id} className="partida-linha" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 8 }}>
              {livre ? <input type="checkbox" name="transferencias" value={t.id} form="form-conciliar" /> : <span />}
              <span><span className="pequeno suave tabular">{formatarData(t.data)}</span><br />{t.descricao}</span>
              <span className="num tabular">{formatarReais(t.destinoId === d.conta!.id ? t.valorCentavos : -t.valorCentavos)}</span>
            </label>
          ))}
          {d.abertas!.length > 0 && <h3>Em aberto (serão baixadas ao conciliar)</h3>}
          {d.abertas!.map((p) => (
            <label key={p.id} className="partida-linha" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 8 }}>
              {livre ? <input type="checkbox" name="parcelas" value={p.id} form="form-conciliar" /> : <span />}
              <span><span className="pequeno suave tabular">vence {formatarData(p.vencimento)}</span><br />{p.titulo.descricao}{p.titulo.favorecido ? ` · ${p.titulo.favorecido.nome}` : ""}</span>
              <span className="num tabular">{formatarReais((p.titulo.tipo === "RECEBER" ? 1n : -1n) * p.valorCentavos)}</span>
            </label>
          ))}
        </section>
      </div>

      {d.conciliacoes!.length > 0 && (
        <details className="painel-form">
          <summary>Conciliações do mês ({d.conciliacoes!.length})</summary>
          <div>
            <ul className="pilha" style={{ listStyle: "none", padding: 0, margin: 0, gap: 8 }}>
              {d.conciliacoes!.map((c) => (
                <li key={c.id} className="linha" style={{ justifyContent: "space-between" }}>
                  <span className="pequeno">{c.transacoes.map((t) => t.descricao).join(", ")} ↔ {c.parcelas.map((p) => p.titulo.descricao).join(", ") || "transferência"} · {c.automatica ? `automática (${c.confianca})` : "manual"} · {formatarInstante(c.criadoEm)}</span>
                  {livre && <Formulario acao={acaoDesfazer.bind(null, clienteId, c.id)} confirmar="Desfazer esta conciliação?"><BotaoEnviar className="texto pequeno">Desfazer</BotaoEnviar></Formulario>}
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      <section className="cartao pilha">
        <h2>Fechamento de {rotuloCompetencia(mes)}</h2>
        {fechado ? (
          <>
            <p>Fechada em {formatarInstante(d.fechamento!.fechadoEm)}. Saldo no sistema ao fim do mês: {formatarReais(d.fechamento!.saldoSistemaCentavos)}.</p>
            {pode(acesso.usuario.perfil, "contabil.fechar") && (
              <Formulario acao={acaoReabrirConciliacao.bind(null, clienteId, d.conta.id, isoCompetencia(mes))} className="campos" confirmar="Reabrir a conciliação deste mês?">
                <Campo nome="justificativa" rotulo="Motivo da reabertura" obrigatorio />
                <BotaoEnviar className="perigo pequeno">Reabrir</BotaoEnviar>
              </Formulario>
            )}
          </>
        ) : (
          <>
            <ul className="pequeno" style={{ margin: 0 }}>
              <li>{d.div!.pendentes.length} transação(ões) do banco sem conciliar</li>
              <li>{d.div!.baixasSemBanco.length} baixa(s) do sistema sem transação no banco{d.div!.baixasSemBanco.length > 0 && `: ${d.div!.baixasSemBanco.map((b) => b.descricao).join(", ")}`}</li>
              <li>{d.div!.transferenciasSemBanco.length} transferência(s) sem transação no banco</li>
              <li>Saldo: {d.div!.saldoExtrato === null ? "o extrato não informou saldo" : d.div!.saldoExtrato === d.div!.saldoSistema ? "extrato e sistema iguais" : `diferença de ${formatarReais(d.div!.saldoExtrato - d.div!.saldoSistema)}`}</li>
            </ul>
            {operar && <Formulario acao={acaoFecharConciliacao.bind(null, clienteId, d.conta.id, isoCompetencia(mes))} confirmar="Fechar a conciliação do mês? Depois, só o contador reabre."><BotaoEnviar>Fechar conciliação do mês</BotaoEnviar></Formulario>}
          </>
        )}
      </section>
    </div>
  );
}
