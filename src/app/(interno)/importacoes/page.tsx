import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { exigirAcesso } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { formatarInstante } from "@/lib/br";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Selo, SITUACAO_IMP } from "@/components/Selo";
import { acaoReceber } from "./acoes";

export const metadata: Metadata = { title: "Importar planilhas" };


export default async function Importacoes() {
  const { ctx } = await exigirAcesso("importacao.clientes");
  const lista = await comEscritorio(ctx, (tx) => tx.importacao.findMany({ orderBy: { criadoEm: "desc" }, take: 30 }));
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <h1>Importar planilhas</h1>
          <p className="suave">Traga os clientes das planilhas atuais. Primeiro conferimos tudo e mostramos o que vai acontecer; só depois você confirma.</p>
        </div>
      </div>
      <section className="cartao pilha">
        <h2>Clientes</h2>
        <p>Use XLSX ou CSV com uma linha por cliente. Colunas mínimas: <strong>cpf_cnpj</strong> e <strong>nome</strong>. As demais são opcionais.</p>
        <p><a className="botao secundario pequeno" href="/importacoes/modelo"><Download size={16} aria-hidden /> Baixar planilha modelo (CSV)</a></p>
        <Formulario acao={acaoReceber} className="campos">
          <Campo nome="arquivo" rotulo="Planilha" tipo="file" aceitar=".xlsx,.csv" obrigatorio ajuda="Até 5 MB e 2.000 linhas." />
          <div><BotaoEnviar>Conferir planilha</BotaoEnviar></div>
        </Formulario>
        <p className="suave pequeno">Plano de contas e saldos iniciais entram na fase 2, junto com a contabilidade.</p>
      </section>
      {lista.length > 0 && (
        <section className="cartao">
          <h2>Importações recentes</h2>
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Arquivo</th><th>Situação</th><th>Enviado em</th></tr></thead>
              <tbody>
                {lista.map((i) => (
                  <tr key={i.id}>
                    <td><Link href={`/importacoes/${i.id}`}>{i.nomeOriginal}</Link></td>
                    <td><Selo tom={SITUACAO_IMP[i.situacao][1]}>{SITUACAO_IMP[i.situacao][0]}</Selo></td>
                    <td className="pequeno">{formatarInstante(i.criadoEm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
