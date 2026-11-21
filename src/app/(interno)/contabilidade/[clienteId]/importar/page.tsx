import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { exigirAcesso } from "@/lib/auth/sessao";
import { pode } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { formatarInstante, isoData, hojeSaoPaulo } from "@/lib/br";
import { clienteOu404 } from "@/lib/contabil/pagina";
import type { LinhaConferencia } from "@/lib/contabil/importacoes";
import { CabecalhoContabil } from "@/components/contabil/Cabecalho";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Selo, SITUACAO_IMP } from "@/components/Selo";
import { acaoAplicarContabil, acaoReceberContabil } from "../../acoes";

export const metadata: Metadata = { title: "Importar plano e saldos" };

const TOM = { criar: "positivo", ignorar: "neutro", erro: "erro" } as const;
const ROTULO = { criar: "Entra", ignorar: "Já existe", erro: "Com erro" } as const;

export default async function Importar({ params, searchParams }: { params: Promise<{ clienteId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { clienteId } = await params;
  const sp = await searchParams;
  const acesso = await exigirAcesso("contabil.importar");
  const d = await comEscritorio(acesso.ctx, async (tx) => ({
    cliente: await clienteOu404(tx, acesso, clienteId),
    temPlano: (await tx.contaContabil.count({ where: { plano: { clienteId } } })) > 0,
    conferir: sp.conferir && /^[0-9a-f-]{36}$/i.test(sp.conferir) ? await tx.importacao.findFirst({ where: { id: sp.conferir, clienteId } }) : null,
    recentes: await tx.importacao.findMany({ where: { clienteId, tipo: { in: ["PLANO_DE_CONTAS", "SALDOS_INICIAIS"] } }, orderBy: { criadoEm: "desc" }, take: 10 }),
  }));
  const imp = d.conferir;
  const resumo = (imp?.resumo ?? {}) as Record<string, string | number | null>;
  const linhas = (imp?.erros ?? []) as unknown as LinhaConferencia[];
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <CabecalhoContabil clienteId={clienteId} nome={d.cliente.pessoa.nome} codigo={d.cliente.codigo} atual="/importar" />

      {imp && (
        <section className="cartao pilha">
          <header>
            <h2>Conferência: {imp.tipo === "PLANO_DE_CONTAS" ? "plano de contas" : "saldos iniciais"}</h2>
            <Selo tom={SITUACAO_IMP[imp.situacao][1]}>{SITUACAO_IMP[imp.situacao][0]}</Selo>
          </header>
          <p className="pequeno suave">{imp.nomeOriginal}</p>
          {imp.tipo === "PLANO_DE_CONTAS" ? (
            <p>{resumo.criar} conta(s) a criar, {resumo.ignorar} já existente(s), {resumo.erros} com erro.{imp.situacao === "APLICADA" ? ` ${resumo.criadas} conta(s) criada(s).` : ""}</p>
          ) : (
            <p className="tabular">Data {String(resumo.data ?? "").split("-").reverse().join("/")} · devedores {resumo.debitos} · credores {resumo.creditos}{resumo.diferenca ? ` · diferença ${resumo.diferenca}` : " · fecha"}{imp.situacao === "APLICADA" ? ` · lançamento nº ${resumo.lancamento}` : ""}</p>
          )}
          {imp.situacao === "COM_ERROS" && <div className="aviso erro" role="alert">Corrija a planilha e envie de novo. Nada foi gravado.{resumo.diferenca ? " Os saldos devedores e credores precisam ser iguais." : ""}</div>}
          {imp.situacao === "PRONTA" && (
            <Formulario acao={acaoAplicarContabil.bind(null, clienteId, imp.id)} confirmar="Aplicar esta importação?">
              <BotaoEnviar>{imp.tipo === "PLANO_DE_CONTAS" ? "Criar as contas" : "Lançar os saldos iniciais"}</BotaoEnviar>
            </Formulario>
          )}
          {imp.situacao === "APLICADA" && (
            <div className="aviso positivo" role="status">
              <span>Importação aplicada. {imp.tipo === "PLANO_DE_CONTAS" ? <Link href={`/contabilidade/${clienteId}/plano`}>Ver plano de contas</Link> : <Link href={`/contabilidade/${clienteId}/relatorios?tipo=balanco&ate=${resumo.data}`}>Ver balanço de abertura</Link>}</span>
            </div>
          )}
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th className="num">Linha</th><th>Conta</th><th>Nome</th><th>Resultado</th><th>Detalhes</th></tr></thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.numero}><td className="num">{l.numero}</td><td className="tabular">{l.rotulo}</td><td>{l.detalhe}</td><td><Selo tom={TOM[l.acao]}>{ROTULO[l.acao]}</Selo></td><td className="pequeno">{l.mensagens.join(" ")}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grade grade-2">
        <section className="cartao pilha">
          <h2>Plano de contas</h2>
          <p className="pequeno">Colunas: <strong>codigo</strong>, <strong>nome</strong>, tipo (S ou A), natureza (D ou C), grupo (Ativo, Passivo, Patrimônio líquido, Receita, Custo, Despesa), disponivel (sim para caixa e bancos), referencial. O grupo pode vir só nas contas de nível 1: as demais herdam da conta-pai.</p>
          <p><a className="botao secundario pequeno" href={`/contabilidade/${clienteId}/importar/modelo?tipo=plano`}><Download size={16} aria-hidden /> Modelo CSV</a></p>
          <Formulario acao={acaoReceberContabil.bind(null, clienteId, "PLANO")} className="campos">
            <Campo nome="arquivo" rotulo="Planilha do plano" tipo="file" aceitar=".xlsx,.csv" obrigatorio />
            <div><BotaoEnviar>Conferir plano</BotaoEnviar></div>
          </Formulario>
        </section>
        <section className="cartao pilha">
          <h2>Saldos iniciais</h2>
          {!d.temPlano ? <p>Configure o plano de contas primeiro.</p> : (
            <>
              <p className="pequeno">Colunas: <strong>conta</strong> (código), <strong>debito</strong> e <strong>credito</strong>; ou <strong>saldo</strong> e natureza (D ou C). Só contas analíticas. Devedores e credores precisam fechar. Vira um lançamento de saldo inicial na data escolhida.</p>
              <p><a className="botao secundario pequeno" href={`/contabilidade/${clienteId}/importar/modelo?tipo=saldos`}><Download size={16} aria-hidden /> Modelo CSV</a></p>
              <Formulario acao={acaoReceberContabil.bind(null, clienteId, "SALDOS")} className="campos">
                <Campo nome="data" rotulo="Data dos saldos" tipo="date" valor={`${isoData(hojeSaoPaulo()).slice(0, 4)}-01-01`} obrigatorio ajuda="Normalmente o primeiro dia do primeiro mês feito no sistema." />
                <Campo nome="arquivo" rotulo="Planilha dos saldos" tipo="file" aceitar=".xlsx,.csv" obrigatorio />
                <div><BotaoEnviar>Conferir saldos</BotaoEnviar></div>
              </Formulario>
            </>
          )}
        </section>
      </div>

      {d.recentes.length > 0 && (
        <section className="cartao">
          <h2>Importações recentes</h2>
          <table>
            <tbody>
              {d.recentes.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/contabilidade/${clienteId}/importar?conferir=${r.id}`}>{r.nomeOriginal}</Link></td>
                  <td>{r.tipo === "PLANO_DE_CONTAS" ? "Plano" : "Saldos"}</td>
                  <td><Selo tom={SITUACAO_IMP[r.situacao][1]}>{SITUACAO_IMP[r.situacao][0]}</Selo></td>
                  <td className="pequeno">{formatarInstante(r.criadoEm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {!pode(acesso.usuario.perfil, "contabil.importar") && null}
    </div>
  );
}
