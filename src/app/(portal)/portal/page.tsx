import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirAcessoPortal } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";

export const metadata: Metadata = { title: "Portal do cliente" };

export default async function Portal() {
  const { usuario, ctx } = await exigirAcessoPortal();
  const acessos = await comEscritorio(ctx, (tx) => tx.acessoCliente.findMany({ where: { usuarioId: usuario.id }, include: { cliente: { include: { pessoa: { select: { nome: true } } } } } }));
  if (acessos.length === 1) redirect(`/portal/${acessos[0].clienteId}`);
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <h1>Olá, {usuario.nome.split(" ")[0]}.</h1>
      {acessos.length === 0 ? <p>Seu acesso ainda não foi ligado a nenhuma empresa. Fale com o escritório.</p> : (
        <section className="cartao pilha"><h2>Escolha a empresa</h2>
          {acessos.map((a) => <Link key={a.clienteId} className="botao secundario" href={`/portal/${a.clienteId}`} style={{ justifyContent: "flex-start" }}>{a.cliente.pessoa.nome}</Link>)}
        </section>
      )}
    </div>
  );
}
