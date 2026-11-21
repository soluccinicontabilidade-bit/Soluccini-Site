import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAcesso } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { SeloSituacao } from "@/components/Selo";
import { acaoClientesDaCarteira } from "../../equipe/acoes";

export const metadata: Metadata = { title: "Carteira" };

export default async function Carteira({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await exigirAcesso("carteiras.gerenciar");
  const d = await comEscritorio(ctx, async (tx) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const carteira = await tx.carteira.findUnique({ where: { id }, include: { clientes: true } });
    if (!carteira) return null;
    return {
      carteira,
      clientes: await tx.cliente.findMany({ where: { excluidoEm: null, situacao: { not: "ENCERRADO" } }, include: { pessoa: { select: { nome: true } } }, orderBy: { pessoa: { nome: "asc" } } }),
      equipe: await tx.usuario.findMany({ where: { ativo: true, perfil: { in: ["ANALISTA_BPO", "ANALISTA_IRPF", "CONTADOR", "ADMINISTRADOR"] } }, orderBy: { nome: "asc" } }),
    };
  });
  if (!d) notFound();
  const marcados = new Set(d.carteira.clientes.map((c) => c.clienteId));
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <span className="trilha"><Link href="/carteiras">Carteiras</Link> / {d.carteira.nome}</span>
          <h1>Carteira {d.carteira.nome}</h1>
        </div>
      </div>
      <Formulario acao={acaoClientesDaCarteira.bind(null, id)} className="cartao pilha">
        <Campo nome="responsavelId" rotulo="Responsável" valor={d.carteira.responsavelId} opcoes={d.equipe.map((u) => ({ valor: u.id, rotulo: u.nome }))} />
        <fieldset>
          <legend>Clientes desta carteira</legend>
          <div className="pilha" style={{ gap: 8 }}>
            {d.clientes.map((c) => (
              <label key={c.id} className="opcao">
                <input type="checkbox" name="clientes" value={c.id} defaultChecked={marcados.has(c.id)} />
                <span>nº {c.codigo} · {c.pessoa.nome}</span> <SeloSituacao situacao={c.situacao} />
              </label>
            ))}
          </div>
        </fieldset>
        <div><BotaoEnviar>Salvar carteira</BotaoEnviar></div>
      </Formulario>
    </div>
  );
}
