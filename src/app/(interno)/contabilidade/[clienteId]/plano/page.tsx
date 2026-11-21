import type { Metadata } from "next";
import Link from "next/link";
import { exigirAcesso } from "@/lib/auth/sessao";
import { pode } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { clienteOu404 } from "@/lib/contabil/pagina";
import { CabecalhoContabil } from "@/components/contabil/Cabecalho";
import { PlanoEditor } from "@/components/contabil/PlanoEditor";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { acaoCopiarModelo } from "../../acoes";

export const metadata: Metadata = { title: "Plano de contas" };

export default async function PlanoCliente({ params }: { params: Promise<{ clienteId: string }> }) {
  const { clienteId } = await params;
  const acesso = await exigirAcesso("contabil.ver");
  const d = await comEscritorio(acesso.ctx, async (tx) => ({
    cliente: await clienteOu404(tx, acesso, clienteId),
    plano: await tx.planoDeContas.findUnique({ where: { clienteId }, include: { contas: true, copiadoDe: { select: { nome: true } } } }),
    modelos: await tx.planoDeContas.findMany({ where: { clienteId: null }, include: { _count: { select: { contas: true } } }, orderBy: { nome: "asc" } }),
  }));
  const editavel = pode(acesso.usuario.perfil, "contabil.plano");
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <CabecalhoContabil clienteId={clienteId} nome={d.cliente.pessoa.nome} codigo={d.cliente.codigo} atual="/plano" />
      {!d.plano || d.plano.contas.length === 0 ? (
        <section className="cartao pilha">
          <h2>Este cliente ainda não tem plano de contas</h2>
          {!editavel ? <p>Peça ao contador para configurar o plano.</p> : (
            <>
              {d.modelos.length > 0 ? (
                <Formulario acao={acaoCopiarModelo.bind(null, clienteId)} className="campos campos-2">
                  <Campo nome="modeloId" rotulo="Copiar de um modelo" opcoes={d.modelos.map((m) => ({ valor: m.id, rotulo: `${m.nome} (${m._count.contas} contas)` }))} />
                  <div className="ocupa-tudo"><BotaoEnviar>Copiar modelo para este cliente</BotaoEnviar></div>
                </Formulario>
              ) : (
                <p>Nenhum modelo criado. <Link href="/contabilidade/modelos">Crie o modelo padrão</Link> ou importe o plano.</p>
              )}
              <p>Ou <Link href={`/contabilidade/${clienteId}/importar`}>importe o plano de uma planilha</Link> (XLSX ou CSV).</p>
            </>
          )}
        </section>
      ) : (
        <>
          <p className="suave pequeno">{d.plano.contas.length} contas{d.plano.copiadoDe ? `, copiadas de "${d.plano.copiadoDe.nome}"` : ""}. Contas com lançamentos não mudam de tipo nem de grupo; para deixar de usar, inative.</p>
          <PlanoEditor planoId={d.plano.id} contas={d.plano.contas} editavel={editavel} />
        </>
      )}
    </div>
  );
}
