import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import type { CategoriaItemIRPF, SituacaoItemIRPF } from "@prisma/client";
import { exigirAcesso } from "@/lib/auth/sessao";
import { pode } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { formatarData, formatarInstante, formatarReais, isoData } from "@/lib/br";
import { autorDoAcesso } from "@/lib/contabil/pagina";
import { dadosDasEmpresas, declaracaoVisivel, NOME_CATEGORIA_ITEM, NOME_SITUACAO_DECL, NOME_SITUACAO_ITEM, ORDEM_FUNIL, tabelaDoAno } from "@/lib/irpf/irpf";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Selo } from "@/components/Selo";
import { GerarLink } from "@/components/irpf/GerarLink";
import { acaoDadosDeclaracao, acaoGerarLink, acaoItem, acaoNovoItem, acaoRevogarLinks, acaoSimular, acaoSituacao } from "../acoes";

export const metadata: Metadata = { title: "Declaração IRPF" };

const R = (v: string | undefined) => (v === undefined ? "—" : formatarReais(BigInt(v)));

export default async function Declaracao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const acesso = await exigirAcesso("irpf.ver");
  const d = await comEscritorio(acesso.ctx, async (tx) => {
    const decl = await declaracaoVisivel(tx, autorDoAcesso(acesso), id);
    if (!decl) return null;
    return {
      decl,
      itens: await tx.itemDocumentoIRPF.findMany({ where: { declaracaoId: id }, orderBy: [{ categoria: "asc" }, { descricao: "asc" }] }),
      versoes: await tx.versaoDocumento.findMany({ where: { documento: { clienteId: decl.clienteId } }, select: { id: true, documentoId: true }, orderBy: { versao: "desc" } }),
      eventos: await tx.eventoDeclaracao.findMany({ where: { declaracaoId: id }, orderBy: { ocorridoEm: "desc" }, take: 50 }),
      links: await tx.linkEnvio.findMany({ where: { declaracaoId: id, revogadoEm: null, expiraEm: { gt: new Date() } } }),
      cliente: await tx.cliente.findUniqueOrThrow({ where: { id: decl.clienteId }, include: { pessoa: { select: { nome: true } } } }),
      empresas: await dadosDasEmpresas(tx, decl.pessoaId, decl.anoCalendario),
      tabela: await tabelaDoAno(tx, acesso.usuario.escritorioId, decl.anoCalendario),
      equipe: await tx.usuario.findMany({ where: { ativo: true, perfil: { in: ["ANALISTA_IRPF", "CONTADOR", "ADMINISTRADOR"] } }, orderBy: { nome: "asc" } }),
      usuarios: await tx.usuario.findMany({ select: { id: true, nome: true } }),
    };
  });
  if (!d) notFound();
  const { decl } = d;
  const operar = pode(acesso.usuario.perfil, "irpf.operar");
  const nome = (uid: string | null) => (uid ? d.usuarios.find((u) => u.id === uid)?.nome ?? "" : "Contribuinte (link)");
  const sim = decl.simulacao as { entrada: Record<string, string>; resultado: { completo: Record<string, string> & { detalhes: [string, string][] }; simplificado: Record<string, string>; melhor: string; avisos: string[] }; calculadoEm: string } | null;
  const ent = sim?.entrada ?? {};
  const totalEmpresas = (t: string) => d.empresas.filter((x) => x.tipo === t).reduce((s, x) => s + x.valor, 0n);
  const versaoDoDoc = (docId: string | null) => d.versoes.find((v) => v.documentoId === docId)?.id;
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <span className="trilha"><Link href={`/irpf?ano=${decl.anoCalendario}`}>IRPF {decl.anoCalendario}</Link> / <Link href={`/clientes/${decl.clienteId}`}>{d.cliente.pessoa.nome}</Link></span>
          <h1>{decl.pessoa.nome}</h1>
          <div className="linha">
            <Selo tom={decl.situacao === "MALHA_FINA" ? "erro" : decl.situacao === "FINALIZADA" || decl.situacao === "TRANSMITIDA" ? "positivo" : "atencao"}>{NOME_SITUACAO_DECL[decl.situacao]}</Selo>
            {decl.retificadora && <span className="etiqueta">Retificadora ({decl.retificacoes})</span>}
            {decl.prazo && <span className="pequeno suave">Prazo {formatarData(decl.prazo)}</span>}
          </div>
        </div>
      </div>
      <div className="aviso info">A transmissão é feita no programa oficial da Receita Federal. Este painel organiza, confere e acompanha.</div>

      <div className="grade grade-2">
        <section className="cartao pilha">
          <h2>Andamento</h2>
          {decl.recibo && <p className="pequeno">Recibo {decl.recibo} · transmitida em {formatarData(decl.transmitidaEm)}</p>}
          {decl.resultadoCentavos !== null && <p><strong>{decl.resultadoCentavos < 0n ? "A restituir" : "A pagar"}: {formatarReais(decl.resultadoCentavos < 0n ? -decl.resultadoCentavos : decl.resultadoCentavos)}</strong>{decl.modelo && <span className="suave"> · modelo {decl.modelo === "COMPLETO" ? "completo" : "simplificado"}</span>}</p>}
          {decl.pendenciasMalha && <div className="aviso erro">Malha fina: {decl.pendenciasMalha}</div>}
          {operar && (
            <Formulario acao={acaoSituacao.bind(null, id)} className="campos campos-2">
              <Campo nome="para" rotulo="Mover para" valor={decl.situacao} opcoes={ORDEM_FUNIL.map((s) => ({ valor: s, rotulo: NOME_SITUACAO_DECL[s] }))} />
              <Campo nome="modelo" rotulo="Modelo" valor={decl.modelo ?? ""} opcoes={[{ valor: "", rotulo: "—" }, { valor: "COMPLETO", rotulo: "Completo" }, { valor: "SIMPLIFICADO", rotulo: "Simplificado" }]} />
              <Campo nome="recibo" rotulo="Nº do recibo" valor={decl.recibo} ajuda="Para transmitida." />
              <Campo nome="transmitidaEm" rotulo="Data da transmissão" tipo="date" valor={isoData(decl.transmitidaEm)} />
              <Campo nome="resultado" rotulo="Resultado (R$)" valor={decl.resultadoCentavos === null ? "" : formatarReais(decl.resultadoCentavos).replace("R$ ", "")} ajuda="Negativo = restituição." />
              <Campo nome="pendenciasMalha" rotulo="Pendências da malha" valor={decl.pendenciasMalha} />
              <label className="opcao ocupa-tudo"><input type="checkbox" name="retificar" value="sim" /> Iniciar retificadora (volta para digitação)</label>
              <div className="ocupa-tudo"><BotaoEnviar className="secundario">Atualizar andamento</BotaoEnviar></div>
            </Formulario>
          )}
        </section>
        <section className="cartao pilha">
          <h2>Dados do serviço</h2>
          <Formulario acao={acaoDadosDeclaracao.bind(null, id)} className="campos campos-2">
            <Campo nome="responsavelId" rotulo="Responsável" valor={decl.responsavelId ?? ""} opcoes={[{ valor: "", rotulo: "Ninguém" }, ...d.equipe.map((u) => ({ valor: u.id, rotulo: u.nome }))]} />
            <Campo nome="prazo" rotulo="Prazo" tipo="date" valor={isoData(decl.prazo)} />
            <Campo nome="honorario" rotulo="Honorário (R$)" valor={decl.honorarioCentavos === null ? "" : formatarReais(decl.honorarioCentavos).replace("R$ ", "")} />
            <Campo nome="honorarioPago" rotulo="Honorário pago?" valor={decl.honorarioPago ? "sim" : "nao"} opcoes={[{ valor: "nao", rotulo: "Não" }, { valor: "sim", rotulo: "Sim" }]} />
            <Campo nome="observacoes" rotulo="Observações" tipo="textarea" valor={decl.observacoes} className="ocupa-tudo" />
            {operar && <div className="ocupa-tudo"><BotaoEnviar className="secundario">Salvar</BotaoEnviar></div>}
          </Formulario>
        </section>
      </div>

      <section className="cartao pilha">
        <header><h2>Documentos</h2><span className="pequeno suave">{d.itens.filter((i) => i.situacao !== "PENDENTE").length} de {d.itens.length} resolvidos</span></header>
        {operar && <GerarLink acao={acaoGerarLink.bind(null, id)} />}
        {d.links.length > 0 && operar && (
          <div className="linha pequeno">Link ativo até {formatInstanteCurto(d.links[0].expiraEm)}{d.links[0].ultimoUsoEm ? `, usado em ${formatInstanteCurto(d.links[0].ultimoUsoEm)}` : ", ainda não usado"}.
            <Formulario acao={acaoRevogarLinks.bind(null, id)}><BotaoEnviar className="texto pequeno">Desativar link</BotaoEnviar></Formulario></div>
        )}
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Documento</th><th>Situação</th>{operar && <th>Atualizar</th>}</tr></thead>
            <tbody>
              {d.itens.map((i) => {
                const versao = versaoDoDoc(i.documentoId);
                return (
                  <tr key={i.id}>
                    <td><span className="suave pequeno">{NOME_CATEGORIA_ITEM[i.categoria]}</span><br />{i.descricao}{versao && <> · <a href={`/api/documentos/${versao}`}><Download size={14} aria-hidden /> arquivo</a></>}{i.observacao && <div className="pequeno suave">{i.observacao}</div>}</td>
                    <td><Selo tom={i.situacao === "PENDENTE" ? "atencao" : i.situacao === "NAO_SE_APLICA" ? "neutro" : "positivo"}>{NOME_SITUACAO_ITEM[i.situacao]}</Selo></td>
                    {operar && (
                      <td>
                        <Formulario acao={acaoItem.bind(null, id, i.id)} className="linha">
                          <select name="situacao" defaultValue="" aria-label="Nova situação"><option value="">Manter</option>{(Object.keys(NOME_SITUACAO_ITEM) as SituacaoItemIRPF[]).map((s) => <option key={s} value={s}>{NOME_SITUACAO_ITEM[s]}</option>)}</select>
                          <input type="file" name="arquivo" aria-label={`Arquivo para ${i.descricao}`} style={{ maxWidth: 220 }} />
                          <BotaoEnviar className="secundario pequeno">Salvar</BotaoEnviar>
                        </Formulario>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {operar && (
          <Formulario acao={acaoNovoItem.bind(null, id)} className="linha" limparAoConcluir>
            <select name="categoria" aria-label="Categoria do documento">{(Object.keys(NOME_CATEGORIA_ITEM) as CategoriaItemIRPF[]).map((c) => <option key={c} value={c}>{NOME_CATEGORIA_ITEM[c]}</option>)}</select>
            <input name="descricao" aria-label="Descrição do documento" placeholder="Outro documento a pedir" style={{ flex: 1 }} />
            <BotaoEnviar className="secundario pequeno">Adicionar ao checklist</BotaoEnviar>
          </Formulario>
        )}
      </section>

      <section className="cartao pilha">
        <h2>Valores pagos pelas empresas clientes</h2>
        {d.empresas.length === 0 ? <p className="suave">Nenhum pró-labore ou distribuição de lucros baixado em {decl.anoCalendario} para esta pessoa no financeiro dos clientes. O pagamento precisa usar uma categoria marcada para IRPF e o favorecido com o CPF do sócio.</p> : (
          <>
            <p>Pró-labore: <strong>{formatarReais(totalEmpresas("PRO_LABORE"))}</strong> · Lucros e dividendos: <strong>{formatarReais(totalEmpresas("DISTRIBUICAO_LUCROS"))}</strong></p>
            <div className="tabela-rolagem"><table>
              <thead><tr><th>Data</th><th>Empresa</th><th>Tipo</th><th>Origem</th><th className="num">Valor</th></tr></thead>
              <tbody>{d.empresas.map((x, n) => <tr key={n}><td>{formatarData(x.data)}</td><td><Link href={`/financeiro/${x.clienteId}`}>{x.empresa}</Link></td><td>{x.tipo === "PRO_LABORE" ? "Pró-labore" : "Lucros"}</td><td className="pequeno">{x.descricao}</td><td className="num">{formatarReais(x.valor)}</td></tr>)}</tbody>
            </table></div>
            <p className="pequeno suave">Confira com o informe de rendimentos da empresa. Retenções (INSS, IRRF) vêm do informe.</p>
          </>
        )}
      </section>

      <section className="cartao pilha">
        <h2>Simulação: completo × simplificado</h2>
        {!d.tabela ? <div className="aviso atencao">Não há tabela de {decl.anoCalendario}. O administrador cadastra em <Link href="/irpf/tabelas">IRPF › Tabelas</Link>.</div> : (
          <>
            {!d.tabela.confirmada && <div className="aviso atencao">A tabela de {decl.anoCalendario} ainda não foi confirmada nas fontes oficiais. Resultado só como estimativa.</div>}
            {operar && (
              <Formulario acao={acaoSimular.bind(null, id)} className="campos campos-3">
                <Campo nome="rendimentosTributaveis" rotulo="Rendimentos tributáveis" valor={ent.rendimentosTributaveis ?? (totalEmpresas("PRO_LABORE") ? formatarReais(totalEmpresas("PRO_LABORE")).replace("R$ ", "") : "")} obrigatorio inputMode="decimal" />
                <Campo nome="previdenciaOficial" rotulo="Previdência oficial (INSS)" valor={ent.previdenciaOficial} inputMode="decimal" />
                <Campo nome="impostoRetido" rotulo="IRRF e carnê-leão pagos" valor={ent.impostoRetido} inputMode="decimal" />
                <Campo nome="dependentes" rotulo="Dependentes" tipo="number" valor={ent.dependentes ?? "0"} />
                <Campo nome="despesasMedicas" rotulo="Despesas médicas" valor={ent.despesasMedicas} inputMode="decimal" />
                <Campo nome="instrucao" rotulo="Instrução por pessoa" valor={ent.instrucao} ajuda="Um valor por pessoa, separados por ponto e vírgula." />
                <Campo nome="pgbl" rotulo="Previdência privada (PGBL)" valor={ent.pgbl} inputMode="decimal" />
                <Campo nome="pensaoAlimenticia" rotulo="Pensão alimentícia judicial" valor={ent.pensaoAlimenticia} inputMode="decimal" />
                <Campo nome="rendimentosTotais" rotulo="Rendimentos totais (com isentos)" valor={ent.rendimentosTotais} inputMode="decimal" ajuda="Opcional, para avisos de alta renda." />
                <div className="ocupa-tudo"><BotaoEnviar>Simular</BotaoEnviar></div>
              </Formulario>
            )}
            {sim && (
              <>
                {sim.resultado.avisos.map((a) => <div key={a} className="aviso atencao pequeno">{a}</div>)}
                <div className="tabela-rolagem"><table>
                  <thead><tr><th></th><th className="num">Completo</th><th className="num">Simplificado</th></tr></thead>
                  <tbody>
                    {([["Deduções", "deducoes"], ["Base de cálculo", "base"], ["Imposto pela tabela", "impostoTabela"], ["Redução", "reducao"], ["Imposto devido", "impostoDevido"], ["Saldo (+ pagar / − restituir)", "saldo"]] as const).map(([r, k]) => (
                      <tr key={k} className={k === "saldo" ? "linha-total" : undefined}><td>{r}</td><td className="num">{R(sim.resultado.completo[k])}</td><td className="num">{R(sim.resultado.simplificado[k])}</td></tr>
                    ))}
                  </tbody>
                </table></div>
                <p><strong>Melhor: {sim.resultado.melhor === "COMPLETO" ? "completo" : "simplificado"}.</strong> <span className="suave pequeno">Calculado em {formatInstanteCurto(new Date(sim.calculadoEm))}.</span></p>
              </>
            )}
          </>
        )}
      </section>

      <section className="cartao"><h2>Histórico</h2>
        <ol className="tempo">{d.eventos.map((e) => <li key={e.id}><span>{e.resumo}<span className="suave pequeno" style={{ display: "block" }}>{formatarInstante(e.ocorridoEm)} · {nome(e.usuarioId)}</span></span></li>)}</ol>
      </section>
    </div>
  );
}

const formatInstanteCurto = (d: Date) => formatarInstante(d);
