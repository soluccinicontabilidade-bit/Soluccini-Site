import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import type { RecorrenciaTarefa } from "@prisma/client";
import { exigirAcesso } from "@/lib/auth/sessao";
import { filtroClientes } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { formatarData, hojeSaoPaulo, isoData } from "@/lib/br";
import { NOME_RECORRENCIA } from "@/lib/tarefas";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Selo } from "@/components/Selo";
import { acaoConcluirTarefa, acaoNovaTarefa } from "../acoes-gestao";

export const metadata: Metadata = { title: "Tarefas e obrigações" };

export default async function Tarefas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { usuario, ctx } = await exigirAcesso();
  const hoje = hojeSaoPaulo();
  const minhas = sp.ver !== "todas";
  const d = await comEscritorio(ctx, async (tx) => {
    const clientes = await tx.cliente.findMany({ where: filtroClientes(usuario), include: { pessoa: { select: { nome: true } } }, orderBy: { pessoa: { nome: "asc" } } });
    const ids = clientes.map((c) => c.id);
    return {
      clientes,
      tarefas: await tx.tarefa.findMany({
        where: { AND: [{ OR: [{ clienteId: null }, { clienteId: { in: ids } }] }, minhas ? { OR: [{ responsavelId: usuario.id }, { responsavelId: null }] } : {}, sp.concluidas ? {} : { concluidaEm: null }] },
        include: { cliente: { include: { pessoa: { select: { nome: true } } } } }, orderBy: { prazo: "asc" }, take: 300,
      }),
      equipe: await tx.usuario.findMany({ where: { ativo: true, perfil: { in: ["ADMINISTRADOR", "CONTADOR", "ANALISTA_BPO", "ANALISTA_IRPF"] } }, orderBy: { nome: "asc" } }),
    };
  });
  const nome = (id: string | null) => d.equipe.find((u) => u.id === id)?.nome.split(" ")[0] ?? "Ninguém";
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho"><div className="sobre"><h1>Tarefas e obrigações</h1><p className="suave">Calendário de obrigações e tarefas por cliente, com responsável, prazo e aviso.</p></div></div>
      <div className="linha">
        <Link className={`botao pequeno ${minhas ? "" : "secundario"}`} href="/tarefas">Minhas e sem responsável</Link>
        <Link className={`botao pequeno ${minhas ? "secundario" : ""}`} href="/tarefas?ver=todas">Todas</Link>
        <Link className="botao texto pequeno" href={`/tarefas?${minhas ? "" : "ver=todas&"}${sp.concluidas ? "" : "concluidas=1"}`}>{sp.concluidas ? "Esconder concluídas" : "Mostrar concluídas"}</Link>
      </div>
      <section className="cartao">
        <ul className="checklist">
          {d.tarefas.map((t) => (
            <li key={t.id} className={t.concluidaEm ? "feito" : ""}>
              <form action={acaoConcluirTarefa.bind(null, t.id, !t.concluidaEm)}>
                <button className="marca" type="submit" aria-pressed={!!t.concluidaEm}>
                  <span className="caixa" aria-hidden>{t.concluidaEm && <Check size={16} />}</span>
                  <span style={{ flex: 1 }}>
                    <span className="texto">{t.titulo}</span>
                    <span className="suave pequeno" style={{ display: "block" }}>{t.cliente ? `${t.cliente.pessoa.nome} · ` : ""}{nome(t.responsavelId)}{t.recorrencia !== "NENHUMA" ? ` · ${NOME_RECORRENCIA[t.recorrencia].toLowerCase()}` : ""}</span>
                  </span>
                  <Selo tom={t.concluidaEm ? "positivo" : t.prazo < hoje ? "erro" : t.prazo.getTime() - hoje.getTime() <= 3 * 86400_000 ? "atencao" : "neutro"}>{formatarData(t.prazo)}</Selo>
                </button>
              </form>
            </li>
          ))}
        </ul>
        {d.tarefas.length === 0 && <p className="suave">Nenhuma tarefa.</p>}
      </section>
      <section className="cartao">
        <h2>Nova tarefa</h2>
        <Formulario acao={acaoNovaTarefa} className="campos campos-3" limparAoConcluir>
          <Campo nome="titulo" rotulo="O que fazer" obrigatorio className="ocupa-2" placeholder="Ex.: Enviar balancete de março" />
          <Campo nome="prazo" rotulo="Prazo" tipo="date" valor={isoData(hoje)} obrigatorio />
          <Campo nome="clienteId" rotulo="Cliente" opcoes={[{ valor: "", rotulo: "Interna (sem cliente)" }, ...d.clientes.map((c) => ({ valor: c.id, rotulo: c.pessoa.nome }))]} />
          <Campo nome="responsavelId" rotulo="Responsável" valor={usuario.id} opcoes={[{ valor: "", rotulo: "Ninguém" }, ...d.equipe.map((u) => ({ valor: u.id, rotulo: u.nome }))]} />
          <Campo nome="recorrencia" rotulo="Repetição" valor="NENHUMA" opcoes={(Object.keys(NOME_RECORRENCIA) as RecorrenciaTarefa[]).map((r) => ({ valor: r, rotulo: NOME_RECORRENCIA[r] }))} ajuda="Ao concluir, a próxima é criada sozinha." />
          <Campo nome="descricao" rotulo="Detalhes" tipo="textarea" className="ocupa-tudo" />
          <div className="ocupa-tudo"><BotaoEnviar>Criar tarefa</BotaoEnviar></div>
        </Formulario>
      </section>
    </div>
  );
}
