import type { Metadata } from "next";
import Link from "next/link";
import { exigirAcesso } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { formatarInstante } from "@/lib/br";
import { acaoLerNotificacoes } from "../acoes-gestao";

export const metadata: Metadata = { title: "Avisos" };

export default async function Notificacoes() {
  const { usuario, ctx } = await exigirAcesso();
  const avisos = await comEscritorio(ctx, (tx) => tx.notificacao.findMany({ where: { usuarioId: usuario.id }, orderBy: { criadaEm: "desc" }, take: 100 }));
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho"><div className="sobre"><h1>Avisos</h1><p className="suave">Gerados todos os dias: prazos, documentos que vencem e aprovações do cliente.</p></div>
        <form action={acaoLerNotificacoes}><button className="botao secundario" type="submit">Marcar todos como lidos</button></form></div>
      <section className="cartao">
        {avisos.length === 0 ? <p className="suave">Nenhum aviso.</p> : (
          <ul className="pilha" style={{ listStyle: "none", margin: 0, padding: 0, gap: 12 }}>
            {avisos.map((a) => <li key={a.id} style={{ fontWeight: a.lidaEm ? 400 : 600 }}>{a.link ? <Link href={a.link}>{a.titulo}</Link> : a.titulo}<span className="suave pequeno"> · {formatarInstante(a.criadaEm)}</span></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
