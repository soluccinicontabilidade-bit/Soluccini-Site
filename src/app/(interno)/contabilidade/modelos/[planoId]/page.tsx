import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAcesso } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { PlanoEditor } from "@/components/contabil/PlanoEditor";

export const metadata: Metadata = { title: "Modelo de plano de contas" };

export default async function Modelo({ params }: { params: Promise<{ planoId: string }> }) {
  const { planoId } = await params;
  const { ctx } = await exigirAcesso("contabil.plano");
  if (!/^[0-9a-f-]{36}$/i.test(planoId)) notFound();
  const plano = await comEscritorio(ctx, (tx) => tx.planoDeContas.findFirst({ where: { id: planoId, clienteId: null }, include: { contas: true } }));
  if (!plano) notFound();
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <span className="trilha"><Link href="/contabilidade">Contabilidade</Link> / <Link href="/contabilidade/modelos">Modelos</Link></span>
          <h1>{plano.nome}</h1>
        </div>
      </div>
      <PlanoEditor planoId={plano.id} contas={plano.contas} editavel />
    </div>
  );
}
