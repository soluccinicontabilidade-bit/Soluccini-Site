import type { Metadata } from "next";
import Link from "next/link";
import { exigirAcesso } from "@/lib/auth/sessao";
import { pode } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { formatarInstante, formatarReais, hojeSaoPaulo } from "@/lib/br";
import { isoCompetencia, NOME_SITUACAO_PERIODO, rotuloCompetencia } from "@/lib/contabil/lancamentos";
import { contasQuePedemJustificativa } from "@/lib/contabil/periodos";
import { clienteOu404 } from "@/lib/contabil/pagina";
import { CabecalhoContabil } from "@/components/contabil/Cabecalho";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Selo } from "@/components/Selo";
import { acaoApurar, acaoPeriodo } from "../../acoes";

export const metadata: Metadata = { title: "Fechamento" };

const TOM = { ABERTO: "positivo", EM_CONFERENCIA: "atencao", FECHADO: "neutro" } as const;

export default async function Fechamento({ params }: { params: Promise<{ clienteId: string }> }) {
  const { clienteId } = await params;
  const acesso = await exigirAcesso("contabil.ver");
  const perfil = acesso.usuario.perfil;
  const d = await comEscritorio(acesso.ctx, async (tx) => {
    const cliente = await clienteOu404(tx, acesso, clienteId);
    const periodos = await tx.periodoContabil.findMany({
      where: { clienteId },
      include: {
        _count: { select: { lancamentos: { where: { excluidoEm: null } } } },
        transicoes: { orderBy: { ocorridaEm: "desc" }, take: 3 },
        justificativas: { orderBy: { criadaEm: "desc" } },
      },
      orderBy: { competencia: "desc" },
    });
    // O próximo a fechar é o mais antigo que não está fechado.
    const proximo = [...periodos].reverse().find((p) => p.situacao !== "FECHADO");
    const pendentes = proximo?.situacao === "EM_CONFERENCIA" ? await contasQuePedemJustificativa(tx, clienteId, proximo.competencia) : [];
    const usuarios = await tx.usuario.findMany({ select: { id: true, nome: true } });
    const contasPl = await tx.contaContabil.findMany({ where: { plano: { clienteId }, grupo: "PATRIMONIO_LIQUIDO", analitica: true, ativa: true }, orderBy: { codigo: "asc" } });
    return { cliente, periodos, proximo, pendentes, usuarios, contasPl };
  });
  const nome = (id: string) => d.usuarios.find((u) => u.id === id)?.nome ?? "";
  const ultimoFechado = d.periodos.find((p) => p.situacao === "FECHADO");
  const anoAtual = hojeSaoPaulo().getUTCFullYear();

  return (
    <div className="pilha" style={{ gap: 24 }}>
      <CabecalhoContabil clienteId={clienteId} nome={d.cliente.pessoa.nome} codigo={d.cliente.codigo} atual="/fechamento" />
      <div className="aviso info">
        <span>Fluxo do mês: <strong>aberto</strong> (recebe lançamentos) → <strong>em conferência</strong> (travado para revisão) → <strong>fechado</strong> pelo contador. Os meses fecham em ordem e são reabertos do mais recente para o mais antigo, sempre com justificativa.</span>
      </div>

      {d.periodos.length === 0 && <div className="cartao vazio"><p>Ainda não há lançamentos para este cliente.</p></div>}

      {d.periodos.map((p) => {
        const ehProximo = d.proximo?.id === p.id;
        const ehUltimoFechado = ultimoFechado?.id === p.id;
        const comp = isoCompetencia(p.competencia);
        return (
          <section key={p.id} className="cartao pilha">
            <header>
              <h2>{rotuloCompetencia(p.competencia)}</h2>
              <div className="linha">
                <span className="pequeno suave">{p._count.lancamentos} lançamento(s)</span>
                <Selo tom={TOM[p.situacao]}>{NOME_SITUACAO_PERIODO[p.situacao]}</Selo>
              </div>
            </header>
            {p.situacao === "FECHADO" && p.fechadoEm && <p className="pequeno">Fechado em {formatarInstante(p.fechadoEm)}{p.fechadoPorId ? ` por ${nome(p.fechadoPorId)}` : ""}.</p>}
            {p.justificativas.length > 0 && p.situacao === "FECHADO" && (
              <ul className="pequeno" style={{ margin: 0 }}>
                {p.justificativas.map((j) => <li key={j.id}>{j.descricaoConta}: {j.texto}</li>)}
              </ul>
            )}
            <div className="linha">
              <Link className="botao secundario pequeno" href={`/contabilidade/${clienteId}?mes=${comp}`}>Lançamentos</Link>
              <Link className="botao secundario pequeno" href={`/contabilidade/${clienteId}/relatorios?tipo=balancete&de=${comp}-01&ate=${comp}-${String(new Date(Date.UTC(p.competencia.getUTCFullYear(), p.competencia.getUTCMonth() + 1, 0)).getUTCDate())}`}>Balancete</Link>
            </div>

            {p.situacao === "ABERTO" && pode(perfil, "contabil.conferencia") && (
              <Formulario acao={acaoPeriodo.bind(null, clienteId, comp, "EM_CONFERENCIA")}>
                <BotaoEnviar className="secundario">Enviar para conferência</BotaoEnviar>
              </Formulario>
            )}
            {p.situacao === "EM_CONFERENCIA" && (
              <div className="grade grade-2">
                {pode(perfil, "contabil.conferencia") && (
                  <Formulario acao={acaoPeriodo.bind(null, clienteId, comp, "ABERTO")}>
                    <BotaoEnviar className="secundario">Devolver para aberto</BotaoEnviar>
                  </Formulario>
                )}
                {pode(perfil, "contabil.fechar") && ehProximo && (
                  <Formulario acao={acaoPeriodo.bind(null, clienteId, comp, "FECHADO")} className="campos" confirmar={`Fechar ${rotuloCompetencia(p.competencia)}? Depois disso o mês não aceita alterações.`}>
                    {d.pendentes.length > 0 && (
                      <fieldset>
                        <legend>Contas de caixa e bancos</legend>
                        <p className="pequeno suave" style={{ marginBottom: 12 }}>Até a conciliação bancária existir, justifique o saldo de cada conta (por exemplo, &quot;saldo conferido com o extrato de {rotuloCompetencia(p.competencia)}&quot;).</p>
                        <div className="campos">
                          {d.pendentes.map(({ conta, mov }) => (
                            <Campo key={conta.id} nome={`conta:${conta.id}`} rotulo={`${conta.codigo} ${conta.nome} · saldo ${formatarReais(mov.final)}`} obrigatorio />
                          ))}
                        </div>
                      </fieldset>
                    )}
                    <BotaoEnviar>Fechar {rotuloCompetencia(p.competencia)}</BotaoEnviar>
                  </Formulario>
                )}
                {pode(perfil, "contabil.fechar") && !ehProximo && <p className="pequeno suave">Feche antes os meses anteriores.</p>}
                {!pode(perfil, "contabil.fechar") && <p className="pequeno suave">Aguardando o contador fechar.</p>}
              </div>
            )}
            {p.situacao === "FECHADO" && ehUltimoFechado && pode(perfil, "contabil.fechar") && (
              <details className="painel-form">
                <summary>Reabrir {rotuloCompetencia(p.competencia)}</summary>
                <div>
                  <Formulario acao={acaoPeriodo.bind(null, clienteId, comp, "ABERTO")} className="campos" confirmar="Reabrir este mês? Fica registrado na auditoria.">
                    <input type="hidden" name="de" value="FECHADO" />
                    <Campo nome="justificativa" rotulo="Motivo da reabertura" tipo="textarea" obrigatorio />
                    <BotaoEnviar className="perigo">Reabrir</BotaoEnviar>
                  </Formulario>
                </div>
              </details>
            )}
            {p.transicoes.length > 0 && (
              <details>
                <summary className="pequeno">Histórico</summary>
                <ul className="pequeno">
                  {p.transicoes.map((t) => (
                    <li key={t.id}>{formatarInstante(t.ocorridaEm)} · {nome(t.usuarioId)}: {NOME_SITUACAO_PERIODO[t.de].toLowerCase()} → {NOME_SITUACAO_PERIODO[t.para].toLowerCase()}{t.justificativa ? ` (${t.justificativa})` : ""}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        );
      })}

      {pode(perfil, "contabil.fechar") && d.contasPl.length > 0 && (
        <details className="painel-form">
          <summary>Apuração do resultado do exercício</summary>
          <div className="pilha">
            <p className="pequeno">Zera as contas de receita, custo e despesa do ano contra uma conta do patrimônio líquido, em 31/12. Dezembro precisa estar aberto. Para refazer, estorne a apuração anterior.</p>
            <Formulario acao={acaoApurar.bind(null, clienteId)} className="campos campos-2" confirmar="Lançar a apuração do resultado?">
              <Campo nome="ano" rotulo="Ano" tipo="number" valor={String(anoAtual)} obrigatorio />
              <Campo nome="contaDestinoId" rotulo="Conta de destino" valor={d.contasPl.find((c) => /lucros/i.test(c.nome))?.id ?? d.contasPl[0].id}
                opcoes={d.contasPl.map((c) => ({ valor: c.id, rotulo: `${c.codigo} ${c.nome}` }))} />
              <div className="ocupa-tudo"><BotaoEnviar className="secundario">Apurar resultado</BotaoEnviar></div>
            </Formulario>
          </div>
        </details>
      )}
    </div>
  );
}
