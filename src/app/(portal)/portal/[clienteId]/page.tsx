import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { exigirAcessoPortal } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { formatarData, formatarInstante, formatarReais, hojeSaoPaulo } from "@/lib/br";
import { obterClienteVisivel } from "@/lib/clientes";
import { isoCompetencia, rotuloCompetencia } from "@/lib/contabil/lancamentos";
import { saldoDaConta } from "@/lib/financeiro/financeiro";
import { NOME_CATEGORIA_ITEM, NOME_SITUACAO_DECL } from "@/lib/irpf/irpf";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Selo } from "@/components/Selo";
import { PixQr } from "@/components/PixQr";
import { acaoAceitar, acaoDecidir, acaoEnviarDoc, acaoEnviarIrpf } from "../acoes";

export const metadata: Metadata = { title: "Portal do cliente" };

const ABAS = [["inicio", "Início"], ["pagamentos", "Pagamentos"], ["relatorios", "Relatórios"], ["documentos", "Documentos"], ["irpf", "Imposto de Renda"], ["honorarios", "Honorários"]] as const;

export default async function PortalCliente({ params, searchParams }: { params: Promise<{ clienteId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { clienteId } = await params;
  const sp = await searchParams;
  const acesso = await exigirAcessoPortal();
  const autor = { id: acesso.usuario.id, escritorioId: acesso.usuario.escritorioId, perfil: acesso.usuario.perfil };
  const hoje = hojeSaoPaulo();
  const aba = (ABAS.find(([k]) => k === sp.aba)?.[0] ?? "inicio") as (typeof ABAS)[number][0];
  const d = await comEscritorio(acesso.ctx, async (tx) => {
    const c = await obterClienteVisivel(tx, autor, clienteId);
    if (!c) return null;
    const contas = await tx.contaBancaria.findMany({ where: { clienteId, ativa: true } });
    return {
      c,
      caixa: contas.length ? (await Promise.all(contas.map((x) => saldoDaConta(tx, x.id, hoje)))).reduce((a, b) => a + b, 0n) : null,
      aguardando: await tx.parcela.findMany({ where: { clienteId, situacao: "AGUARDANDO_APROVACAO" }, include: { titulo: { include: { favorecido: true, anexos: { include: { versoes: { orderBy: { versao: "desc" }, take: 1 } } } } } }, orderBy: { vencimento: "asc" } }),
      vencidas: await tx.parcela.count({ where: { clienteId, situacao: { in: ["ABERTA", "APROVADA"] }, vencimento: { lt: hoje }, titulo: { canceladoEm: null, tipo: "PAGAR" } } }),
      fechados: await tx.periodoContabil.findMany({ where: { clienteId, situacao: "FECHADO" }, orderBy: { competencia: "desc" }, take: 24 }),
      documentos: await tx.documento.findMany({ where: { clienteId, excluidoEm: null }, include: { versoes: { orderBy: { versao: "desc" }, take: 1 }, categoria: true }, orderBy: { criadoEm: "desc" }, take: 100 }),
      declaracoes: await tx.declaracaoIRPF.findMany({ where: { clienteId }, include: { pessoa: { select: { nome: true } }, itens: { orderBy: { categoria: "asc" } } }, orderBy: { anoCalendario: "desc" } }),
      cobrancas: await tx.cobranca.findMany({ where: { clienteId, situacao: { not: "CANCELADA" } }, orderBy: { vencimento: "desc" }, take: 24 }),
      aceites: await tx.solicitacaoAceite.findMany({ where: { clienteId, canceladaEm: null }, include: { aceites: { where: { usuarioId: acesso.usuario.id } } }, orderBy: { criadoEm: "desc" } }),
      escritorio: (await tx.escritorio.findUniqueOrThrow({ where: { id: acesso.usuario.escritorioId }, select: { nome: true } })).nome,
    };
  });
  if (!d) notFound();
  const aprovador = acesso.usuario.perfil === "CLIENTE_APROVADOR";
  const docTitulo = (id: string) => d.documentos.find((x) => x.id === id);
  const aceitesPendentes = d.aceites.filter((s) => !s.aceites.length);
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho"><div className="sobre"><h1>{d.c.pessoa.nome}</h1><p className="suave">Atendido por {d.escritorio}</p></div></div>
      <nav className="abas" aria-label="Seções do portal">
        {ABAS.map(([k, r]) => <Link key={k} href={`/portal/${clienteId}?aba=${k}`} aria-current={aba === k ? "page" : undefined}>{r}{k === "pagamentos" && d.aguardando.length ? ` (${d.aguardando.length})` : ""}</Link>)}
      </nav>

      {aba === "inicio" && (
        <div className="pilha">
          {aceitesPendentes.map((s) => {
            const doc = docTitulo(s.documentoId);
            return (
              <section key={s.id} className="cartao pilha">
                <h2>Documento para você ler e aceitar</h2>
                <p>{s.mensagem ?? doc?.titulo}</p>
                {doc?.versoes[0] && <a className="botao secundario pequeno" href={`/portal/documento/${s.versaoId}`} style={{ justifySelf: "start" }}><Download size={16} aria-hidden /> Baixar e ler: {doc.titulo}</a>}
                <Formulario acao={acaoAceitar.bind(null, clienteId, s.id)} className="pilha">
                  <label className="opcao"><input type="checkbox" name="concordo" value="sim" required /> Li o documento e concordo com seu conteúdo.</label>
                  <BotaoEnviar>Registrar meu aceite</BotaoEnviar>
                </Formulario>
                <p className="pequeno suave">O aceite fica registrado com seu nome, data, hora, endereço de rede e a impressão digital (SHA-256) do arquivo.</p>
              </section>
            );
          })}
          <section className="grade grade-3">
            <div className="cartao indicador"><span className="rotulo">Saldo das contas hoje</span><span className="valor" style={{ fontSize: 22 }}>{d.caixa === null ? "—" : formatarReais(d.caixa)}</span></div>
            <Link href={`/portal/${clienteId}?aba=pagamentos`} className="cartao indicador" style={{ textDecoration: "none" }}><span className="rotulo">Pagamentos aguardando você</span><span className="valor">{d.aguardando.length}</span></Link>
            <div className="cartao indicador"><span className="rotulo">Contas a pagar vencidas</span><span className="valor">{d.vencidas}</span></div>
          </section>
          {d.fechados[0] && <p>Último mês fechado pela contabilidade: <Link href={`/portal/${clienteId}?aba=relatorios`}>{rotuloCompetencia(d.fechados[0].competencia)}</Link>.</p>}
        </div>
      )}

      {aba === "pagamentos" && (
        <section className="cartao pilha">
          <h2>Pagamentos aguardando aprovação</h2>
          {!aprovador && <p className="aviso info">Seu perfil é de consulta. Quem aprova pagamentos é o aprovador da empresa.</p>}
          {d.aguardando.length === 0 && <p className="suave">Nada para aprovar agora.</p>}
          {d.aguardando.map((p) => (
            <div key={p.id} className="partida-linha pilha" style={{ gap: 8 }}>
              <div className="linha" style={{ justifyContent: "space-between" }}>
                <span><strong>{p.titulo.descricao}</strong>{p.titulo.favorecido && <span className="suave"> · {p.titulo.favorecido.nome}</span>}<br /><span className="pequeno suave">Vence em {formatarData(p.vencimento)}{p.total > 1 ? ` · parcela ${p.numero}/${p.total}` : ""}</span></span>
                <strong className="tabular">{formatarReais(p.valorCentavos)}</strong>
              </div>
              {p.titulo.anexos.map((a) => a.versoes[0] && <a key={a.id} className="pequeno" href={`/portal/documento/${a.versoes[0].id}`}><Download size={14} aria-hidden /> {a.titulo}</a>)}
              {aprovador && (
                <div className="linha">
                  <Formulario acao={acaoDecidir.bind(null, clienteId, p.id, true)}><BotaoEnviar className="pequeno">Aprovar</BotaoEnviar></Formulario>
                  <details className="painel-form"><summary>Não aprovar</summary><div>
                    <Formulario acao={acaoDecidir.bind(null, clienteId, p.id, false)} className="campos"><Campo nome="motivo" rotulo="Por quê?" obrigatorio /><BotaoEnviar className="perigo pequeno">Não aprovar</BotaoEnviar></Formulario>
                  </div></details>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {aba === "relatorios" && (
        <section className="cartao pilha">
          <h2>Relatórios dos meses fechados</h2>
          {d.fechados.length === 0 && <p className="suave">Nenhum mês fechado ainda.</p>}
          {d.fechados.map((p) => (
            <div key={p.id} className="linha" style={{ justifyContent: "space-between" }}>
              <strong>{rotuloCompetencia(p.competencia)}</strong>
              <div className="linha">
                {([["dre", "Resultado (DRE)"], ["balanco", "Balanço"], ["balancete", "Balancete"]] as const).map(([t, r]) => <a key={t} className="botao secundario pequeno" href={`/portal/${clienteId}/relatorio?tipo=${t}&mes=${isoCompetencia(p.competencia)}`}><Download size={14} aria-hidden /> {r}</a>)}
              </div>
            </div>
          ))}
          <p className="pequeno suave">Relatórios em PDF, gerados na hora com os números do mês fechado.</p>
        </section>
      )}

      {aba === "documentos" && (
        <div className="pilha">
          <section className="cartao pilha">
            <h2>Enviar documento ao escritório</h2>
            <Formulario acao={acaoEnviarDoc.bind(null, clienteId)} className="campos campos-2" limparAoConcluir>
              <Campo nome="titulo" rotulo="Do que se trata" placeholder="Ex.: Notas de compra de março" />
              <Campo nome="arquivo" rotulo="Arquivo" tipo="file" obrigatorio aceitar=".pdf,.png,.jpg,.jpeg,.xml,.xlsx,.csv,.ofx" />
              <div className="ocupa-tudo"><BotaoEnviar>Enviar</BotaoEnviar></div>
            </Formulario>
          </section>
          <section className="cartao">
            <h2>Documentos</h2>
            <table><tbody>{d.documentos.map((x) => <tr key={x.id}><td>{x.versoes[0] ? <a href={`/portal/documento/${x.versoes[0].id}`}><Download size={14} aria-hidden /> {x.titulo}</a> : x.titulo}<div className="pequeno suave">{x.categoria.nome}</div></td><td className="pequeno">{x.validoAte ? `válido até ${formatarData(x.validoAte)}` : ""}</td><td className="pequeno suave">{formatarInstante(x.criadoEm)}</td></tr>)}</tbody></table>
          </section>
        </div>
      )}

      {aba === "irpf" && (
        <div className="pilha">
          {d.declaracoes.length === 0 && <div className="cartao vazio"><p>Nenhuma declaração de Imposto de Renda acompanhada por aqui.</p></div>}
          {d.declaracoes.map((x) => (
            <section key={x.id} className="cartao pilha">
              <header><h2>{x.pessoa.nome} · ano-calendário {x.anoCalendario}</h2><Selo tom={x.situacao === "MALHA_FINA" ? "erro" : x.situacao === "FINALIZADA" || x.situacao === "TRANSMITIDA" ? "positivo" : "atencao"}>{NOME_SITUACAO_DECL[x.situacao]}</Selo></header>
              {x.resultadoCentavos !== null && x.situacao !== "AGUARDANDO_DOCUMENTOS" && <p>{x.resultadoCentavos < 0n ? "Restituição prevista" : "Imposto a pagar"}: <strong>{formatarReais(x.resultadoCentavos < 0n ? -x.resultadoCentavos : x.resultadoCentavos)}</strong></p>}
              {x.itens.filter((i) => i.situacao === "PENDENTE").length > 0 && <h3>Documentos que faltam</h3>}
              {x.itens.filter((i) => i.situacao === "PENDENTE").map((i) => (
                <div key={i.id} className="partida-linha pilha" style={{ gap: 8 }}>
                  <span><span className="pequeno suave">{NOME_CATEGORIA_ITEM[i.categoria]}</span><br />{i.descricao}</span>
                  <Formulario acao={acaoEnviarIrpf.bind(null, clienteId, x.id, i.id)} className="linha" limparAoConcluir>
                    <input type="file" name="arquivo" accept=".pdf,.png,.jpg,.jpeg" aria-label={`Arquivo: ${i.descricao}`} style={{ flex: 1, minWidth: 180 }} />
                    <BotaoEnviar className="pequeno">Enviar</BotaoEnviar>
                  </Formulario>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      {aba === "honorarios" && (
        <section className="cartao pilha">
          <h2>Honorários</h2>
          {d.cobrancas.length === 0 && <p className="suave">Nenhuma cobrança.</p>}
          {d.cobrancas.map((c) => (
            <div key={c.id} className="partida-linha pilha" style={{ gap: 8 }}>
              <div className="linha" style={{ justifyContent: "space-between" }}>
                <span><strong>{c.descricao}</strong><br /><span className="pequeno suave">Vence em {formatarData(c.vencimento)}</span></span>
                <span className="linha"><strong className="tabular">{formatarReais(c.valorCentavos)}</strong>{c.situacao === "PAGA" ? <Selo tom="positivo">Paga</Selo> : <Selo tom={c.vencimento < hoje ? "erro" : "atencao"}>{c.vencimento < hoje ? "Vencida" : "Em aberto"}</Selo>}</span>
              </div>
              {c.situacao === "PENDENTE" && c.pixCopiaECola && (
                <details><summary className="pequeno">Pagar com Pix</summary>
                  <div className="pilha" style={{ marginTop: 8 }}><PixQr codigo={c.pixCopiaECola} /><input readOnly value={c.pixCopiaECola} aria-label="Pix copia e cola" /><p className="pequeno suave">Abra o app do banco, escolha Pix copia e cola e cole o código, ou leia o QR code.</p></div>
                </details>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
