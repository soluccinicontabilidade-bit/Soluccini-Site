import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { exigirAcesso } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { clienteOu404 } from "@/lib/contabil/pagina";
import { contasParaLancar } from "@/lib/contabil/opcoes";
import { FormLancamento } from "@/components/contabil/FormLancamento";
import { acaoNovoLancamento } from "../../../acoes";

export const metadata: Metadata = { title: "Novo lançamento" };

export default async function NovoLancamento({ params, searchParams }: { params: Promise<{ clienteId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { clienteId } = await params;
  const sp = await searchParams;
  const acesso = await exigirAcesso("contabil.lancar");
  const { cliente, contas } = await comEscritorio(acesso.ctx, async (tx) => ({ cliente: await clienteOu404(tx, acesso, clienteId), contas: await contasParaLancar(tx, clienteId) }));
  const data = sp.data && /^\d{4}-\d{2}-\d{2}$/.test(sp.data) ? sp.data : "";
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <span className="trilha"><Link href="/contabilidade">Contabilidade</Link> / <Link href={`/contabilidade/${clienteId}?mes=${data.slice(0, 7)}`}>{cliente.pessoa.nome}</Link> / Novo lançamento</span>
          <h1>Novo lançamento</h1>
          <p className="suave">Débitos e créditos precisam fechar. O número é dado pelo sistema.</p>
        </div>
      </div>
      {sp.ultimo && <div className="aviso positivo" role="status"><Check size={20} aria-hidden /> Lançamento nº {sp.ultimo} registrado. Pode lançar o próximo.</div>}
      {contas.length === 0 ? (
        <div className="aviso atencao">Este cliente ainda não tem contas analíticas. <Link href={`/contabilidade/${clienteId}/plano`}>Configure o plano de contas</Link>.</div>
      ) : (
        <FormLancamento acao={acaoNovoLancamento.bind(null, clienteId)} contas={contas} textoBotao="Salvar lançamento" permitirContinuar
          inicial={{ data, historico: "", origem: "MANUAL", justificativa: "", partidas: [{ conta: "", tipo: "DEBITO", valor: "", historico: "" }, { conta: "", tipo: "CREDITO", valor: "", historico: "" }] }} />
      )}
    </div>
  );
}
