import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAcesso } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { BotaoEnviar, Formulario } from "@/components/Formulario";
import { Selo, SITUACAO_IMP } from "@/components/Selo";
import type { LinhaAnalisada } from "@/lib/importacao";
import { acaoAplicar, acaoCancelar } from "../acoes";

export const metadata: Metadata = { title: "Conferência da importação" };

export default async function Importacao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await exigirAcesso("importacao.clientes");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const imp = await comEscritorio(ctx, (tx) => tx.importacao.findUnique({ where: { id } }));
  if (!imp) notFound();
  const linhas = (imp.erros ?? []) as unknown as Omit<LinhaAnalisada, "dados">[];
  const resumo = (imp.resumo ?? {}) as { criar?: number; ignorar?: number; erros?: number; criados?: number; colunasIgnoradas?: string[] };
  const TOM = { criar: "positivo", ignorar: "neutro", erro: "erro" } as const;
  const ROTULO = { criar: "Será cadastrado", ignorar: "Ignorado", erro: "Com erro" } as const;
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <span className="trilha"><Link href="/importacoes">Importações</Link> / {imp.nomeOriginal}</span>
          <h1>Conferência da planilha</h1>
          <div><Selo tom={SITUACAO_IMP[imp.situacao][1]}>{SITUACAO_IMP[imp.situacao][0]}</Selo></div>
        </div>
      </div>
      <section className="grade grade-3">
        <div className="cartao indicador"><span className="rotulo">{imp.situacao === "APLICADA" ? "Cadastrados" : "Serão cadastrados"}</span><span className="valor">{imp.situacao === "APLICADA" ? resumo.criados : resumo.criar}</span></div>
        <div className="cartao indicador"><span className="rotulo">Já eram clientes (ignorados)</span><span className="valor">{resumo.ignorar}</span></div>
        <div className="cartao indicador"><span className="rotulo">Linhas com erro</span><span className="valor">{resumo.erros}</span></div>
      </section>
      {resumo.colunasIgnoradas && resumo.colunasIgnoradas.length > 0 && (
        <div className="aviso info">Colunas não reconhecidas e ignoradas: {resumo.colunasIgnoradas.join(", ")}.</div>
      )}
      {imp.situacao === "COM_ERROS" && (
        <div className="aviso erro" role="alert">Corrija as linhas com erro na planilha e envie de novo. Nada foi cadastrado.</div>
      )}
      {imp.situacao === "PRONTA" && (
        <section className="cartao pilha">
          <p>Tudo conferido. Ao confirmar, os clientes são cadastrados de uma vez, com o checklist de entrada aberto. Se algo falhar, nada é gravado.</p>
          <div className="linha">
            <Formulario acao={acaoAplicar.bind(null, imp.id)} confirmar={`Cadastrar ${resumo.criar} cliente(s)?`}>
              <BotaoEnviar>Cadastrar {resumo.criar} cliente(s)</BotaoEnviar>
            </Formulario>
            <Formulario acao={acaoCancelar.bind(null, imp.id)}>
              <BotaoEnviar className="secundario">Cancelar importação</BotaoEnviar>
            </Formulario>
          </div>
        </section>
      )}
      {imp.situacao === "APLICADA" && (
        <div className="aviso positivo" role="status">
          <span>Importação aplicada: {resumo.criados} cliente(s) cadastrado(s). <Link href="/clientes?situacao=EM_ENTRADA">Ver clientes em entrada</Link></span>
        </div>
      )}
      <section className="cartao">
        <h2>Linha a linha</h2>
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th className="num">Linha</th><th>Nome</th><th>Resultado</th><th>Detalhes</th></tr></thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.numero}>
                  <td className="num">{l.numero}</td>
                  <td>{l.nome || <span className="suave">(sem nome)</span>}{l.documentoFinal && <div className="suave pequeno">final {l.documentoFinal}</div>}</td>
                  <td><Selo tom={TOM[l.acao]}>{ROTULO[l.acao]}</Selo></td>
                  <td className="pequeno">{l.mensagens.join(" ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
