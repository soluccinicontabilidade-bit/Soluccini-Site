import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { exigirAcesso } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { formatarReais, isoData } from "@/lib/br";
import { ORIGENS_EDITAVEIS } from "@/lib/contabil/lancamentos";
import { clienteOu404 } from "@/lib/contabil/pagina";
import { contasParaLancar } from "@/lib/contabil/opcoes";
import { FormLancamento } from "@/components/contabil/FormLancamento";
import { acaoEditarLancamento } from "../../../../acoes";

export const metadata: Metadata = { title: "Editar lançamento" };

export default async function EditarLancamento({ params }: { params: Promise<{ clienteId: string; lancamentoId: string }> }) {
  const { clienteId, lancamentoId } = await params;
  const acesso = await exigirAcesso("contabil.lancar");
  if (!/^[0-9a-f-]{36}$/i.test(lancamentoId)) notFound();
  const d = await comEscritorio(acesso.ctx, async (tx) => {
    const cliente = await clienteOu404(tx, acesso, clienteId);
    const l = await tx.lancamentoContabil.findFirst({
      where: { id: lancamentoId, clienteId },
      include: { partidas: { include: { conta: true }, orderBy: { ordem: "asc" } }, periodo: true, estornadoPor: true },
    });
    return { cliente, l, contas: await contasParaLancar(tx, clienteId) };
  });
  if (!d.l) notFound();
  const l = d.l;
  if (l.periodo.situacao !== "ABERTO" || !ORIGENS_EDITAVEIS.includes(l.origem) || l.estornadoPor) redirect(`/contabilidade/${clienteId}/lancamentos/${l.id}`);
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <span className="trilha"><Link href="/contabilidade">Contabilidade</Link> / {d.cliente.pessoa.nome} / <Link href={`/contabilidade/${clienteId}/lancamentos/${l.id}`}>nº {l.numero}</Link> / Editar</span>
          <h1>Editar lançamento nº {l.numero}</h1>
        </div>
      </div>
      <FormLancamento acao={acaoEditarLancamento.bind(null, clienteId, l.id)} contas={d.contas} textoBotao="Salvar alterações"
        inicial={{
          data: isoData(l.data), historico: l.historico, origem: l.origem, justificativa: l.justificativa ?? "",
          partidas: l.partidas.map((p) => ({ conta: `${p.conta.codigo} - ${p.conta.nome}`, tipo: p.tipo, valor: formatarReais(p.valorCentavos).replace("R$ ", ""), historico: p.historicoComplementar ?? "" })),
        }} />
    </div>
  );
}
