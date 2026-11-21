import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Table } from "lucide-react";
import type { SituacaoDeclaracao } from "@prisma/client";
import { exigirAcesso } from "@/lib/auth/sessao";
import { filtroClientes, pode } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { formatarData, formatarReais, hojeSaoPaulo } from "@/lib/br";
import { NOME_SITUACAO_DECL, ORDEM_FUNIL } from "@/lib/irpf/irpf";
import { Selo } from "@/components/Selo";

export const metadata: Metadata = { title: "IRPF" };

export default async function Irpf({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { usuario, ctx } = await exigirAcesso("irpf.ver");
  const hoje = hojeSaoPaulo();
  const ano = Number(sp.ano) || hoje.getUTCFullYear() - (hoje.getUTCMonth() < 6 ? 1 : 0);
  const situacao = ORDEM_FUNIL.includes(sp.situacao as SituacaoDeclaracao) ? (sp.situacao as SituacaoDeclaracao) : undefined;
  const d = await comEscritorio(ctx, async (tx) => {
    const todas = await tx.declaracaoIRPF.findMany({
      where: { anoCalendario: ano, cliente: filtroClientes(usuario) },
      include: { pessoa: { select: { nome: true } }, itens: { select: { situacao: true } } },
      orderBy: [{ prazo: { sort: "asc", nulls: "last" } }, { pessoa: { nome: "asc" } }],
    });
    const usuarios = await tx.usuario.findMany({ select: { id: true, nome: true } });
    return { todas, usuarios };
  });
  const lista = situacao ? d.todas.filter((x) => x.situacao === situacao) : d.todas;
  const em15 = new Date(hoje.getTime() + 15 * 86400_000);
  const naoTransmitidas = (x: (typeof d.todas)[number]) => ["AGUARDANDO_DOCUMENTOS", "EM_ANALISE", "EM_DIGITACAO", "EM_REVISAO"].includes(x.situacao);
  const prazos = d.todas.filter((x) => naoTransmitidas(x) && x.prazo && x.prazo <= em15);
  const semResposta = d.todas.filter((x) => x.situacao === "AGUARDANDO_DOCUMENTOS" && (!x.ultimoContatoEm || x.ultimoContatoEm.getTime() < Date.now() - 7 * 86400_000) && x.itens.some((i) => i.situacao === "PENDENTE"));
  const honorarios = d.todas.reduce((s, x) => s + (x.honorarioCentavos ?? 0n), 0n);
  const recebidos = d.todas.filter((x) => x.honorarioPago).reduce((s, x) => s + (x.honorarioCentavos ?? 0n), 0n);
  const nome = (id: string | null) => d.usuarios.find((u) => u.id === id)?.nome.split(" ")[0] ?? "—";
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre"><h1>IRPF {ano}</h1><p className="suave">Ano-calendário {ano}, declaração entregue em {ano + 1}.</p></div>
        <div className="linha">
          <form className="linha"><label htmlFor="ano" className="leitor">Ano-calendário</label><input id="ano" name="ano" type="number" defaultValue={ano} style={{ width: 110 }} /><button className="botao secundario pequeno" type="submit">Ver ano</button></form>
          {pode(usuario.perfil, "irpf.tabelas") && <Link className="botao secundario" href="/irpf/tabelas"><Table size={18} aria-hidden /> Tabelas</Link>}
          {pode(usuario.perfil, "irpf.operar") && <Link className="botao" href={`/irpf/nova?ano=${ano}`}><Plus size={18} aria-hidden /> Nova declaração</Link>}
        </div>
      </div>
      <section className="grade grade-4">
        {ORDEM_FUNIL.map((s) => (
          <Link key={s} href={`/irpf?ano=${ano}${situacao === s ? "" : `&situacao=${s}`}`} className="cartao indicador" style={{ textDecoration: "none", outline: situacao === s ? "2px solid var(--roxo)" : undefined }}>
            <span className="rotulo">{NOME_SITUACAO_DECL[s]}</span><span className="valor">{d.todas.filter((x) => x.situacao === s).length}</span>
          </Link>
        ))}
        <div className="cartao indicador"><span className="rotulo">Honorários (recebidos / total)</span><span className="valor" style={{ fontSize: 20 }}>{formatarReais(recebidos)}</span><span className="pequeno suave">de {formatarReais(honorarios)}</span></div>
      </section>
      <div className="grade grade-2">
        <section className="cartao"><h2>Prazos nos próximos 15 dias</h2>{prazos.length ? <ul>{prazos.map((x) => <li key={x.id}><Link href={`/irpf/${x.id}`}>{x.pessoa.nome}</Link> · {formatarData(x.prazo)} · {NOME_SITUACAO_DECL[x.situacao]}</li>)}</ul> : <p className="suave">Nenhum.</p>}</section>
        <section className="cartao"><h2>Sem resposta há mais de 7 dias</h2>{semResposta.length ? <ul>{semResposta.map((x) => <li key={x.id}><Link href={`/irpf/${x.id}`}>{x.pessoa.nome}</Link> · {x.itens.filter((i) => i.situacao === "PENDENTE").length} documento(s) pendente(s)</li>)}</ul> : <p className="suave">Nenhum.</p>}</section>
      </div>
      <section className="cartao">
        <h2>{situacao ? NOME_SITUACAO_DECL[situacao] : "Todas as declarações"} ({lista.length})</h2>
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Contribuinte</th><th>Situação</th><th>Documentos</th><th>Responsável</th><th>Prazo</th><th className="num">Resultado</th></tr></thead>
            <tbody>
              {lista.map((x) => {
                const ok = x.itens.filter((i) => i.situacao !== "PENDENTE").length;
                return (
                  <tr key={x.id}>
                    <td><Link href={`/irpf/${x.id}`}>{x.pessoa.nome}</Link>{x.retificadora && <span className="etiqueta" style={{ marginLeft: 6 }}>Retificadora</span>}</td>
                    <td><Selo tom={x.situacao === "MALHA_FINA" ? "erro" : x.situacao === "FINALIZADA" || x.situacao === "TRANSMITIDA" ? "positivo" : "atencao"}>{NOME_SITUACAO_DECL[x.situacao]}</Selo></td>
                    <td className="pequeno">{ok}/{x.itens.length}</td>
                    <td className="pequeno">{nome(x.responsavelId)}</td>
                    <td className="pequeno">{formatarData(x.prazo) || "—"}</td>
                    <td className="num">{x.resultadoCentavos === null ? "—" : `${x.resultadoCentavos < 0n ? "Restituir" : "Pagar"} ${formatarReais(x.resultadoCentavos < 0n ? -x.resultadoCentavos : x.resultadoCentavos)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {lista.length === 0 && <p className="suave">Nenhuma declaração.</p>}
      </section>
    </div>
  );
}
