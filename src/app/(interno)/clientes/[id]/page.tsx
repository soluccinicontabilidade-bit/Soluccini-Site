import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Download, Pencil, X } from "lucide-react";
import type { SituacaoCliente } from "@prisma/client";
import { exigirAcesso } from "@/lib/auth/sessao";
import { pode } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import {
  documentoEmClaro, NOME_REGIME, NOME_SERVICO, NOME_SITUACAO, NOME_VINCULO, obterClienteVisivel, valorVigente,
} from "@/lib/clientes";
import { formatarBp, formatarData, formatarDocumento, formatarInstante, formatarReais, hojeSaoPaulo, isoData, mascararDocumento } from "@/lib/br";
import { EXTENSOES_ACEITAS } from "@/lib/documentos";
import { saldoDaConta } from "@/lib/financeiro/financeiro";
import { TIPOS_RELATORIO } from "@/lib/contabil/montar";
import { TIPOS_RELATORIO_FIN } from "@/lib/financeiro/relatorios";
import { acaoAcessoPortal, acaoAgendamento, acaoDesativarAgendamento, acaoRemoverAcesso, acaoSolicitarAceite } from "../../acoes-gestao";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Selo, SeloSituacao } from "@/components/Selo";
import {
  acaoAdicionarSocio, acaoChecklist, acaoCriarContrato, acaoEncerrarContrato, acaoEncerrarSocio, acaoEnviarDocumento,
  acaoEtiqueta, acaoExcluirDocumento, acaoNovaVersao, acaoReajuste, acaoRemoverEtiqueta, acaoSituacao,
} from "../acoes";

export const metadata: Metadata = { title: "Cliente" };

const ABAS = [
  ["dados", "Dados"],
  ["socios", "Sócios"],
  ["contrato", "Contrato"],
  ["documentos", "Documentos"],
  ["entrada", "Entrada"],
  ["portal", "Portal"],
  ["historico", "Histórico"],
] as const;
type Aba = (typeof ABAS)[number][0];

export default async function Cliente({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { usuario, ctx } = await exigirAcesso();
  const autor = { id: usuario.id, escritorioId: usuario.escritorioId, perfil: usuario.perfil };

  const dados = await comEscritorio(ctx, async (tx) => {
    const c = await obterClienteVisivel(tx, autor, id);
    if (!c) return null;
    if (sp.ver === "documento") {
      await tx.eventoCliente.create({
        data: { escritorioId: autor.escritorioId, clienteId: id, tipo: "documento.visualizado", resumo: "CPF/CNPJ completo exibido", usuarioId: autor.id },
      });
    }
    const [extra, vinculos, contratos, documentos, categorias, checklist, eventos, autores] = await Promise.all([
      tx.cliente.findUniqueOrThrow({
        where: { id },
        include: { etiquetas: { include: { etiqueta: true } }, carteiras: { include: { carteira: { include: { responsavel: { select: { nome: true } } } } } } },
      }),
      tx.vinculoSocietario.findMany({ where: { empresaId: c.pessoaId }, include: { socio: { include: { cliente: { select: { id: true } } } } }, orderBy: [{ fim: { sort: "asc", nulls: "first" } }, { participacaoBp: "desc" }] }),
      tx.contrato.findMany({ where: { clienteId: id, excluidoEm: null }, include: { valores: { orderBy: { vigenciaInicio: "desc" } } }, orderBy: { inicio: "desc" } }),
      tx.documento.findMany({ where: { clienteId: id, excluidoEm: null }, include: { categoria: true, versoes: { orderBy: { versao: "desc" } } }, orderBy: { criadoEm: "desc" } }),
      tx.categoriaDocumento.findMany({ orderBy: { nome: "asc" } }),
      tx.itemChecklistEntrada.findMany({ where: { clienteId: id }, orderBy: { ordem: "asc" } }),
      tx.eventoCliente.findMany({ where: { clienteId: id }, orderBy: { ocorridoEm: "desc" }, take: 100 }),
      tx.usuario.findMany({ select: { id: true, nome: true } }),
    ]);
    const mesAtual = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const contasBanc = await tx.contaBancaria.findMany({ where: { clienteId: id, ativa: true } });
    const resumo = {
      caixa: contasBanc.length ? (await Promise.all(contasBanc.map((cb) => saldoDaConta(tx, cb.id, hojeSaoPaulo())))).reduce((a, b) => a + b, 0n) : null,
      resultadoMes: (await tx.rateioTitulo.findMany({ where: { titulo: { clienteId: id, canceladoEm: null, competencia: { gte: mesAtual } } }, include: { titulo: { select: { tipo: true } } } })).reduce((a, r) => a + (r.titulo.tipo === "RECEBER" ? r.valorCentavos : -r.valorCentavos), 0n),
      vencidas: await tx.parcela.count({ where: { clienteId: id, situacao: { in: ["ABERTA", "APROVADA", "REPROVADA"] }, vencimento: { lt: hojeSaoPaulo() }, titulo: { canceladoEm: null } } }),
      conciliar: await tx.transacaoBancaria.count({ where: { clienteId: id, situacao: { in: ["PENDENTE", "SUGERIDA"] } } }),
      docsIrpf: await tx.itemDocumentoIRPF.count({ where: { situacao: "PENDENTE", declaracao: { clienteId: id, situacao: "AGUARDANDO_DOCUMENTOS" } } }),
      docsVencidos: await tx.documento.count({ where: { clienteId: id, excluidoEm: null, validoAte: { lt: hojeSaoPaulo() } } }),
    };
    const portal = {
      acessos: await tx.acessoCliente.findMany({ where: { clienteId: id }, include: { usuario: true } }),
      agendamentos: await tx.agendamentoRelatorio.findMany({ where: { clienteId: id }, include: { envios: { orderBy: { ocorridoEm: "desc" }, take: 1 } }, orderBy: { criadoEm: "desc" } }),
      aceites: await tx.solicitacaoAceite.findMany({ where: { clienteId: id }, include: { aceites: true }, orderBy: { criadoEm: "desc" } }),
    };
    // Empresas em que esta pessoa é sócia (útil para PF: base do IRPF).
    const participacoes = await tx.vinculoSocietario.findMany({
      where: { socioId: c.pessoaId },
      include: { empresa: { include: { cliente: { select: { id: true } } } } },
    });
    return { c, extra, vinculos, contratos, documentos, categorias, checklist, eventos, autores, participacoes, portal, resumo };
  });
  if (!dados) notFound();
  const { c, extra, vinculos, contratos, documentos, categorias, checklist, eventos, autores, participacoes, portal, resumo } = dados;
  const p = c.pessoa;
  const aba: Aba = (ABAS.find(([k]) => k === sp.aba)?.[0] ?? "dados") as Aba;
  const hoje = hojeSaoPaulo();
  const nomeAutor = (uid: string | null) => autores.find((a) => a.id === uid)?.nome ?? "Sistema";
  const pendentes = checklist.filter((i) => !i.concluidoEm).length;
  const podeEditar = pode(usuario.perfil, "clientes.editar");
  const podeContrato = pode(usuario.perfil, "contratos.editar");
  // O documento completo só é decifrado quando a pessoa pede para ver (registro de acesso).
  const mostrarDocumento = sp.ver === "documento";

  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <span className="trilha"><Link href="/clientes">Clientes</Link> / nº {c.codigo}</span>
          <h1>{p.nome}</h1>
          <div className="linha">
            <SeloSituacao situacao={c.situacao} />
            <span className="suave pequeno">
              {p.tipo === "PJ" ? "CNPJ" : "CPF"}{" "}
              {mostrarDocumento ? formatarDocumento(p.tipo, documentoEmClaro(p)) : mascararDocumento(p.tipo, p.documentoFinal)}
            </span>
            {!mostrarDocumento && <Link className="pequeno" href={`/clientes/${id}?aba=${aba}&ver=documento`}>mostrar completo</Link>}
          </div>
        </div>
        {podeEditar && <Link className="botao secundario" href={`/clientes/${id}/editar`}><Pencil size={16} aria-hidden /> Editar dados</Link>}
      </div>

      {sp.novo && (
        <div className="aviso positivo" role="status"><Check size={20} aria-hidden /> Cliente cadastrado com o número {c.codigo}. Próximo passo: concluir o checklist de entrada abaixo.</div>
      )}
      {sp.salvo && <div className="aviso positivo" role="status"><Check size={20} aria-hidden /> Dados salvos.</div>}

      <nav className="abas" aria-label="Seções do cliente">
        {ABAS.filter(([k]) => k !== "socios" || p.tipo === "PJ" || participacoes.length > 0).map(([k, rotulo]) => (
          <Link key={k} href={`/clientes/${id}?aba=${k}`} aria-current={aba === k ? "page" : undefined}>
            {k === "socios" && p.tipo === "PF" ? "Participações" : rotulo}
            {k === "entrada" && pendentes > 0 && c.situacao === "EM_ENTRADA" ? ` (${pendentes})` : ""}
          </Link>
        ))}
      </nav>

      {aba === "dados" && (
        <section className="grade grade-3" aria-label="Situação agora">
          <div className="cartao indicador"><span className="rotulo">Caixa hoje</span><span className="valor" style={{ fontSize: 20 }}>{resumo.caixa === null ? "—" : formatarReais(resumo.caixa)}</span></div>
          <div className="cartao indicador"><span className="rotulo">Resultado do mês (gerencial)</span><span className="valor" style={{ fontSize: 20 }}>{formatarReais(resumo.resultadoMes)}</span></div>
          <div className="cartao indicador"><span className="rotulo">Pendências</span>
            <span className="pequeno">{resumo.vencidas} conta(s) vencida(s) · {resumo.conciliar} transação(ões) a conciliar · {resumo.docsIrpf} documento(s) de IRPF pendente(s) · {resumo.docsVencidos} documento(s) vencido(s)</span></div>
        </section>
      )}
      {aba === "dados" && (
        <div className="grade grade-2">
          <section className="cartao">
            <h2>Cadastro</h2>
            <dl className="definicoes">
              {p.nomeFantasia && <div><dt>Nome fantasia</dt><dd>{p.nomeFantasia}</dd></div>}
              {p.tipo === "PJ" && <div><dt>Regime tributário</dt><dd>{p.regimeTributario ? NOME_REGIME[p.regimeTributario] : "Não informado"}</dd></div>}
              {p.cnaePrincipal && <div><dt>CNAE principal</dt><dd className="num">{p.cnaePrincipal.replace(/^(\d{4})(\d)(\d{2})$/, "$1-$2/$3")}</dd></div>}
              {p.dataAbertura && <div><dt>Abertura</dt><dd>{formatarData(p.dataAbertura)}</dd></div>}
              {p.dataNascimento && <div><dt>Nascimento</dt><dd>{formatarData(p.dataNascimento)}</dd></div>}
              {p.inscricaoEstadual && <div><dt>Inscrição estadual</dt><dd>{p.inscricaoEstadual}</dd></div>}
              {p.inscricaoMunicipal && <div><dt>Inscrição municipal</dt><dd>{p.inscricaoMunicipal}</dd></div>}
              <div><dt>E-mail</dt><dd>{p.email ?? "Não informado"}</dd></div>
              <div><dt>Telefone</dt><dd>{p.telefone ?? "Não informado"}</dd></div>
              <div style={{ gridColumn: "1 / -1" }}><dt>Endereço</dt><dd>
                {p.logradouro ? `${p.logradouro}, ${p.numero ?? "s/n"}${p.complemento ? `, ${p.complemento}` : ""} · ${p.bairro ?? ""} · ${p.municipio ?? ""}/${p.uf ?? ""}${p.cep ? ` · CEP ${p.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2")}` : ""}` : "Não informado"}
              </dd></div>
            </dl>
          </section>
          <div className="pilha">
            <section className="cartao">
              <h2>Atendimento</h2>
              <dl className="definicoes">
                <div><dt>Cliente desde</dt><dd>{formatarData(c.inicioServico)}</dd></div>
                {c.fimServico && <div><dt>Encerrado em</dt><dd>{formatarData(c.fimServico)}</dd></div>}
                <div><dt>Regime contábil</dt><dd>{c.regimeContabil === "CAIXA" ? "Caixa" : "Competência"}</dd></div>
                <div><dt>Carteiras</dt><dd>{extra.carteiras.map((k) => `${k.carteira.nome} (${k.carteira.responsavel.nome})`).join(", ") || "Nenhuma"}</dd></div>
              </dl>
            </section>
            <section className="cartao pilha">
              <h2>Etiquetas</h2>
              <div className="linha">
                {extra.etiquetas.length === 0 && <span className="suave">Nenhuma etiqueta.</span>}
                {extra.etiquetas.map((e) => (
                  <form key={e.etiquetaId} action={acaoRemoverEtiqueta.bind(null, id, e.etiquetaId)} className="linha" style={{ gap: 0 }}>
                    <span className="etiqueta">{e.etiqueta.nome}</span>
                    {podeEditar && <button className="botao texto pequeno" type="submit" aria-label={`Remover etiqueta ${e.etiqueta.nome}`}><X size={14} aria-hidden /></button>}
                  </form>
                ))}
              </div>
              {podeEditar && (
                <Formulario acao={acaoEtiqueta.bind(null, id)} className="linha" limparAoConcluir>
                  <input name="nome" aria-label="Nova etiqueta" placeholder="Nova etiqueta" style={{ flex: 1, minWidth: 160 }} maxLength={40} />
                  <BotaoEnviar className="secundario pequeno">Adicionar</BotaoEnviar>
                </Formulario>
              )}
            </section>
            {pode(usuario.perfil, "clientes.situacao") && (
              <section className="cartao">
                <h2>Situação</h2>
                <Formulario acao={acaoSituacao.bind(null, id)} className="campos campos-2">
                  <Campo nome="situacao" rotulo="Nova situação" valor={c.situacao}
                    opcoes={(Object.keys(NOME_SITUACAO) as SituacaoCliente[]).map((s) => ({ valor: s, rotulo: NOME_SITUACAO[s] }))} />
                  <Campo nome="fim" rotulo="Data de encerramento" tipo="date" ajuda="Só para encerrar o atendimento." />
                  <div className="ocupa-tudo"><BotaoEnviar className="secundario">Alterar situação</BotaoEnviar></div>
                </Formulario>
              </section>
            )}
          </div>
        </div>
      )}

      {aba === "socios" && (
        <div className="pilha">
          {p.tipo === "PJ" && (
            <section className="cartao">
              <header><h2>Sócios e administradores</h2>
                <span className="suave pequeno num">Participação ativa: {formatarBp(vinculos.filter((v) => !v.fim).reduce((s, v) => s + v.participacaoBp, 0))}</span>
              </header>
              {vinculos.length === 0 ? <p className="suave">Nenhum sócio cadastrado.</p> : (
                <div className="tabela-rolagem">
                  <table>
                    <thead><tr><th>Nome</th><th>Vínculo</th><th className="num">Participação</th><th>Período</th><th></th></tr></thead>
                    <tbody>
                      {vinculos.map((v) => (
                        <tr key={v.id}>
                          <td>
                            {v.socio.cliente ? <Link href={`/clientes/${v.socio.cliente.id}`}>{v.socio.nome}</Link> : v.socio.nome}
                            <div className="suave pequeno">{mascararDocumento(v.socio.tipo, v.socio.documentoFinal)}</div>
                          </td>
                          <td>{NOME_VINCULO[v.tipo]}</td>
                          <td className="num">{formatarBp(v.participacaoBp)}</td>
                          <td className="pequeno">{formatarData(v.inicio)} {v.fim ? `a ${formatarData(v.fim)}` : "até hoje"}</td>
                          <td>
                            {!v.fim && podeEditar ? (
                              <details className="painel-form">
                                <summary>Encerrar</summary>
                                <div>
                                  <Formulario acao={acaoEncerrarSocio.bind(null, id, v.id)} className="campos">
                                    <Campo nome="fim" rotulo="Data de saída" tipo="date" obrigatorio />
                                    <BotaoEnviar className="perigo pequeno">Encerrar vínculo</BotaoEnviar>
                                  </Formulario>
                                </div>
                              </details>
                            ) : v.fim ? <Selo tom="neutro">Encerrado</Selo> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {podeEditar && (
                <details className="painel-form" style={{ marginTop: 16 }}>
                  <summary>Incluir sócio ou administrador</summary>
                  <div>
                    <Formulario acao={acaoAdicionarSocio.bind(null, id)} className="campos campos-2" limparAoConcluir>
                      <Campo nome="documento" rotulo="CPF ou CNPJ" obrigatorio inputMode="numeric" ajuda="Se a pessoa já estiver cadastrada, usamos o cadastro existente." />
                      <Campo nome="nome" rotulo="Nome" ajuda="Obrigatório só para quem ainda não está cadastrado." />
                      <Campo nome="tipo" rotulo="Vínculo" valor="SOCIO" opcoes={Object.entries(NOME_VINCULO).map(([valor, rotulo]) => ({ valor, rotulo }))} />
                      <Campo nome="participacao" rotulo="Participação (%)" inputMode="decimal" placeholder="50,00" ajuda="Administrador sem cotas: deixe em branco." />
                      <Campo nome="inicio" rotulo="Entrada na sociedade" tipo="date" obrigatorio />
                      <div className="ocupa-tudo"><BotaoEnviar>Incluir</BotaoEnviar></div>
                    </Formulario>
                  </div>
                </details>
              )}
            </section>
          )}
          {participacoes.length > 0 && (
            <section className="cartao">
              <h2>Participa das empresas</h2>
              <p className="suave pequeno" style={{ marginBottom: 12 }}>Base para importar pró-labore e lucros no IRPF (fase 5).</p>
              <ul className="pilha" style={{ listStyle: "none", margin: 0, padding: 0, gap: 8 }}>
                {participacoes.map((v) => (
                  <li key={v.id} className="linha" style={{ justifyContent: "space-between" }}>
                    {v.empresa.cliente ? <Link href={`/clientes/${v.empresa.cliente.id}?aba=socios`}>{v.empresa.nome}</Link> : v.empresa.nome}
                    <span className="pequeno num">{NOME_VINCULO[v.tipo]} · {formatarBp(v.participacaoBp)}{v.fim ? ` · saiu em ${formatarData(v.fim)}` : ""}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {aba === "contrato" && (
        <div className="pilha">
          {contratos.length === 0 && <div className="cartao vazio"><p>Nenhum contrato cadastrado.</p></div>}
          {contratos.map((k) => {
            const vigente = valorVigente(k.valores, hoje);
            return (
              <section key={k.id} className="cartao pilha">
                <header>
                  <h2>Contrato desde {formatarData(k.inicio)}</h2>
                  {k.fim ? <Selo tom="neutro">Encerrado em {formatarData(k.fim)}</Selo> : <Selo tom="positivo">Vigente</Selo>}
                </header>
                <dl className="definicoes">
                  <div><dt>Serviços</dt><dd>{k.servicos.map((s) => NOME_SERVICO[s]).join(", ")}</dd></div>
                  <div><dt>Vencimento</dt><dd>Todo dia {k.diaVencimento}</dd></div>
                  <div><dt>Honorário vigente</dt><dd className="num"><strong>{vigente ? formatarReais(vigente.valorCentavos) : "Ainda não vigente"}</strong></dd></div>
                </dl>
                <div className="tabela-rolagem">
                  <table>
                    <thead><tr><th>A partir de</th><th className="num">Valor</th><th>Motivo</th></tr></thead>
                    <tbody>
                      {k.valores.map((v) => (
                        <tr key={v.id}><td>{formatarData(v.vigenciaInicio)}</td><td className="num">{formatarReais(v.valorCentavos)}</td><td>{v.motivo}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!k.fim && podeContrato && (
                  <div className="grade grade-2">
                    <details className="painel-form">
                      <summary>Registrar reajuste</summary>
                      <div>
                        <Formulario acao={acaoReajuste.bind(null, id, k.id)} className="campos" limparAoConcluir>
                          <Campo nome="valor" rotulo="Novo valor (R$)" obrigatorio inputMode="decimal" placeholder="1.250,00" />
                          <Campo nome="vigencia" rotulo="Vale a partir de" tipo="date" obrigatorio />
                          <Campo nome="motivo" rotulo="Motivo" obrigatorio placeholder="Reajuste anual pelo IPCA" />
                          <BotaoEnviar>Registrar reajuste</BotaoEnviar>
                        </Formulario>
                      </div>
                    </details>
                    <details className="painel-form">
                      <summary>Encerrar contrato</summary>
                      <div>
                        <Formulario acao={acaoEncerrarContrato.bind(null, id, k.id)} className="campos" confirmar="Encerrar este contrato?">
                          <Campo nome="fim" rotulo="Data de encerramento" tipo="date" obrigatorio />
                          <BotaoEnviar className="perigo">Encerrar contrato</BotaoEnviar>
                        </Formulario>
                      </div>
                    </details>
                  </div>
                )}
              </section>
            );
          })}
          {podeContrato && !contratos.some((k) => !k.fim) && (
            <section className="cartao">
              <h2>Novo contrato</h2>
              <Formulario acao={acaoCriarContrato.bind(null, id)} className="campos campos-3">
                <fieldset className="ocupa-tudo">
                  <legend>Serviços contratados</legend>
                  <div className="linha" style={{ gap: 24 }}>
                    {Object.entries(NOME_SERVICO).map(([valor, rotulo]) => (
                      <label key={valor} className="opcao"><input type="checkbox" name="servicos" value={valor} /> {rotulo}</label>
                    ))}
                  </div>
                </fieldset>
                <Campo nome="inicio" rotulo="Início" tipo="date" valor={isoData(c.inicioServico)} obrigatorio />
                <Campo nome="diaVencimento" rotulo="Dia de vencimento" tipo="number" valor="10" obrigatorio ajuda="Entre 1 e 28." />
                <Campo nome="valor" rotulo="Honorário mensal (R$)" obrigatorio inputMode="decimal" placeholder="1.200,00" />
                <div className="ocupa-tudo"><BotaoEnviar>Cadastrar contrato</BotaoEnviar></div>
              </Formulario>
            </section>
          )}
        </div>
      )}

      {aba === "documentos" && (
        <div className="pilha">
          {pode(usuario.perfil, "documentos.enviar") && (
            <section className="cartao">
              <h2>Enviar documento</h2>
              <div>
                <Formulario acao={acaoEnviarDocumento.bind(null, id)} className="campos campos-2" limparAoConcluir>
                  <Campo nome="categoriaId" rotulo="Categoria" obrigatorio
                    opcoes={[{ valor: "", rotulo: "Escolha" }, ...categorias.map((k) => ({ valor: k.id, rotulo: k.nome + (k.temValidade ? " (tem validade)" : "") }))]} />
                  <Campo nome="titulo" rotulo="Título" ajuda="Em branco: usa o nome da categoria." />
                  <Campo nome="competencia" rotulo="Competência" tipo="month" ajuda="Mês de referência, se houver." />
                  <Campo nome="validoAte" rotulo="Válido até" tipo="date" ajuda="Obrigatório para certidões, certificados, alvarás e procurações." />
                  <Campo nome="arquivo" rotulo="Arquivo" tipo="file" obrigatorio className="ocupa-tudo" aceitar={EXTENSOES_ACEITAS} ajuda="PDF, imagem, planilha, Word, XML, OFX ou CSV, até 20 MB. O arquivo é guardado cifrado." />
                  <div className="ocupa-tudo"><BotaoEnviar>Enviar documento</BotaoEnviar></div>
                </Formulario>
              </div>
            </section>
          )}
          {documentos.length === 0 ? (
            <div className="cartao vazio"><p>Nenhum documento enviado.</p></div>
          ) : (
            <section className="cartao">
              <div className="tabela-rolagem">
                <table>
                  <thead><tr><th>Documento</th><th>Competência</th><th>Validade</th><th>Versões</th><th></th></tr></thead>
                  <tbody>
                    {documentos.map((d) => {
                      const atual = d.versoes[0];
                      const vencido = d.validoAte && d.validoAte < hoje;
                      const vence = d.validoAte && !vencido && d.validoAte.getTime() - hoje.getTime() <= (d.categoria.avisoDiasAntes ?? 30) * 86400_000;
                      return (
                        <tr key={d.id}>
                          <td>
                            <strong>{d.titulo}</strong>
                            <div className="suave pequeno">{d.categoria.nome}</div>
                          </td>
                          <td className="num">{d.competencia ? isoData(d.competencia).slice(0, 7).split("-").reverse().join("/") : "—"}</td>
                          <td>
                            {d.validoAte ? (
                              <Selo tom={vencido ? "erro" : vence ? "atencao" : "positivo"}>{vencido ? "Vencido" : vence ? "Vence" : "Válido até"} {formatarData(d.validoAte)}</Selo>
                            ) : "—"}
                          </td>
                          <td className="pequeno">
                            {d.versoes.map((v) => (
                              <div key={v.id}>
                                <a href={`/api/documentos/${v.id}`}><Download size={14} aria-hidden /> v{v.versao}</a>{" "}
                                <span className="suave">{formatarInstante(v.enviadoEm)} · {nomeAutor(v.enviadoPorId)}</span>
                              </div>
                            ))}
                          </td>
                          <td>
                            {pode(usuario.perfil, "documentos.enviar") && atual && (
                              <details className="painel-form">
                                <summary>Mais</summary>
                                <div className="pilha">
                                  <Formulario acao={acaoNovaVersao.bind(null, id, d.id)} className="campos">
                                    <Campo nome="arquivo" rotulo="Nova versão" tipo="file" obrigatorio aceitar={EXTENSOES_ACEITAS} />
                                    {d.categoria.temValidade && <Campo nome="validoAte" rotulo="Nova validade" tipo="date" />}
                                    <BotaoEnviar className="pequeno">Enviar versão</BotaoEnviar>
                                  </Formulario>
                                  <Formulario acao={acaoExcluirDocumento.bind(null, id, d.id)} confirmar="Retirar este documento da lista? O arquivo continua guardado.">
                                    <BotaoEnviar className="perigo pequeno">Retirar da lista</BotaoEnviar>
                                  </Formulario>
                                </div>
                              </details>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {aba === "entrada" && (
        <section className="cartao pilha">
          <header>
            <h2>Checklist de entrada</h2>
            <Selo tom={pendentes ? "atencao" : "positivo"}>{pendentes ? `${pendentes} de ${checklist.length} pendente(s)` : "Concluído"}</Selo>
          </header>
          <ul className="checklist">
            {checklist.map((i) => (
              <li key={i.id} className={i.concluidoEm ? "feito" : ""}>
                <form action={acaoChecklist.bind(null, id, i.id, !i.concluidoEm)}>
                  <button className="marca" type="submit" disabled={!podeEditar} aria-pressed={!!i.concluidoEm}>
                    <span className="caixa" aria-hidden>{i.concluidoEm && <Check size={16} />}</span>
                    <span>
                      <span className="texto">{i.descricao}</span>
                      {i.concluidoEm && <span className="suave pequeno" style={{ display: "block" }}>Concluído em {formatarInstante(i.concluidoEm)} por {nomeAutor(i.concluidoPorId)}</span>}
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
          {c.situacao === "EM_ENTRADA" && pendentes === 0 && pode(usuario.perfil, "clientes.situacao") && (
            <Formulario acao={acaoSituacao.bind(null, id)}>
              <input type="hidden" name="situacao" value="ATIVO" />
              <BotaoEnviar>Ativar cliente</BotaoEnviar>
            </Formulario>
          )}
        </section>
      )}

      {aba === "portal" && (
        <div className="pilha">
          <section className="cartao pilha">
            <h2>Acessos ao portal do cliente</h2>
            <p className="pequeno suave">O leitor vê relatórios fechados, documentos, IRPF e honorários, e envia arquivos. O aprovador também aprova pagamentos (com aprovador cadastrado, os pagamentos do BPO passam a exigir aprovação).</p>
            {portal.acessos.length === 0 ? <p className="suave">Ninguém tem acesso ainda.</p> : (
              <ul className="pilha" style={{ listStyle: "none", padding: 0, margin: 0, gap: 8 }}>
                {portal.acessos.map((a) => (
                  <li key={a.usuarioId} className="linha" style={{ justifyContent: "space-between" }}>
                    <span>{a.usuario.nome} · {a.usuario.email} · <Selo tom="neutro">{a.usuario.perfil === "CLIENTE_APROVADOR" ? "Aprovador" : "Leitor"}</Selo> {!a.usuario.totpAtivadoEm && <Selo tom="atencao">Aguardando primeiro acesso</Selo>}</span>
                    {pode(usuario.perfil, "portal.gerenciar") && <Formulario acao={acaoRemoverAcesso.bind(null, id, a.usuarioId)} confirmar={`Remover o acesso de ${a.usuario.nome}?`}><BotaoEnviar className="texto pequeno">Remover</BotaoEnviar></Formulario>}
                  </li>
                ))}
              </ul>
            )}
            {pode(usuario.perfil, "portal.gerenciar") && (
              <details className="painel-form"><summary>Dar acesso</summary><div>
                <Formulario acao={acaoAcessoPortal.bind(null, id)} className="campos campos-3" limparAoConcluir>
                  <Campo nome="nome" rotulo="Nome" obrigatorio />
                  <Campo nome="email" rotulo="E-mail" tipo="email" obrigatorio />
                  <Campo nome="perfil" rotulo="Perfil" valor="CLIENTE_LEITOR" opcoes={[{ valor: "CLIENTE_LEITOR", rotulo: "Leitor" }, { valor: "CLIENTE_APROVADOR", rotulo: "Aprovador de pagamentos" }]} />
                  <div className="ocupa-tudo"><BotaoEnviar>Liberar acesso</BotaoEnviar></div>
                </Formulario>
              </div></details>
            )}
          </section>
          <section className="cartao pilha">
            <h2>Relatórios enviados todo mês</h2>
            <p className="pequeno suave">No dia escolhido, o relatório do mês anterior vai em PDF por e-mail (se o servidor tiver e-mail configurado) e fica guardado nos documentos do cliente.</p>
            {portal.agendamentos.map((ag) => (
              <div key={ag.id} className="linha" style={{ justifyContent: "space-between" }}>
                <span className="pequeno">{ag.modulo === "CONTABIL" ? TIPOS_RELATORIO[ag.tipo as keyof typeof TIPOS_RELATORIO] : TIPOS_RELATORIO_FIN[ag.tipo as keyof typeof TIPOS_RELATORIO_FIN]} · dia {ag.diaDoMes} · {ag.destinatarios.join(", ") || "sem e-mail"} {ag.ativo ? "" : "(desativado)"}{ag.envios[0] ? ` · último: ${ag.envios[0].situacao.toLowerCase().replace(/_/g, " ")}` : ""}</span>
                {ag.ativo && pode(usuario.perfil, "portal.gerenciar") && <form action={acaoDesativarAgendamento.bind(null, id, ag.id)}><button className="botao texto pequeno" type="submit">Desativar</button></form>}
              </div>
            ))}
            {pode(usuario.perfil, "portal.gerenciar") && (
              <Formulario acao={acaoAgendamento.bind(null, id)} className="campos campos-3" limparAoConcluir>
                <Campo nome="relatorio" rotulo="Relatório" opcoes={[...Object.entries(TIPOS_RELATORIO).map(([k, v]) => ({ valor: `CONTABIL:${k}`, rotulo: `Contábil · ${v}` })), ...Object.entries(TIPOS_RELATORIO_FIN).map(([k, v]) => ({ valor: `FINANCEIRO:${k}`, rotulo: `Financeiro · ${v}` }))]} />
                <Campo nome="dia" rotulo="Dia do mês" tipo="number" valor="5" />
                <Campo nome="destinatarios" rotulo="E-mails" valor={c.pessoa.email} ajuda="Separados por vírgula." />
                <div className="ocupa-tudo"><BotaoEnviar className="secundario">Agendar envio</BotaoEnviar></div>
              </Formulario>
            )}
          </section>
          <section className="cartao pilha">
            <h2>Aceite de documentos</h2>
            <p className="pequeno suave">O cliente lê e aceita no portal (assinatura eletrônica simples, com registro de quem, quando, de onde e o hash do arquivo).</p>
            {portal.aceites.map((s) => {
              const doc = documentos.find((d) => d.id === s.documentoId);
              return <div key={s.id} className="pequeno">{doc?.titulo ?? "Documento"}: {s.aceites.length ? s.aceites.map((a) => `aceito por ${a.nomeUsuario} em ${formatarInstante(a.aceitoEm)} (IP ${a.ip ?? "?"}, SHA-256 ${a.sha256Documento.slice(0, 12)}…)`).join("; ") : "aguardando aceite"}</div>;
            })}
            {pode(usuario.perfil, "portal.gerenciar") && documentos.length > 0 && (
              <Formulario acao={acaoSolicitarAceite.bind(null, id)} className="campos campos-2" limparAoConcluir>
                <Campo nome="documentoId" rotulo="Documento" opcoes={documentos.map((d) => ({ valor: d.id, rotulo: d.titulo }))} />
                <Campo nome="mensagem" rotulo="Mensagem ao cliente" placeholder="Ex.: Contrato de prestação de serviços 2026" />
                <div className="ocupa-tudo"><BotaoEnviar className="secundario">Pedir aceite</BotaoEnviar></div>
              </Formulario>
            )}
          </section>
          {pode(usuario.perfil, "lgpd.exportar") && (
            <section className="cartao pilha">
              <h2>LGPD</h2>
              <p className="pequeno">Exporta, em arquivo, todos os dados pessoais guardados sobre o titular (para atender pedido de acesso).</p>
              <a className="botao secundario pequeno" href={`/api/titular/${c.pessoaId}`} style={{ justifySelf: "start" }}>Exportar dados do titular</a>
            </section>
          )}
        </div>
      )}

      {aba === "historico" && (
        <section className="cartao">
          <h2>Linha do tempo</h2>
          <ol className="tempo">
            {eventos.map((e) => (
              <li key={e.id}>
                <span>
                  <span>{e.resumo}</span>
                  <span className="suave pequeno" style={{ display: "block" }}>{formatarInstante(e.ocorridoEm)} · {nomeAutor(e.usuarioId)}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
