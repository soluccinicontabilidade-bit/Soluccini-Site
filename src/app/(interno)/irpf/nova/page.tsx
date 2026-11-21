import type { Metadata } from "next";
import Link from "next/link";
import { exigirAcesso } from "@/lib/auth/sessao";
import { filtroClientes } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { hojeSaoPaulo } from "@/lib/br";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { acaoNovaDeclaracao } from "../acoes";

export const metadata: Metadata = { title: "Nova declaração" };

export default async function NovaDeclaracao({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { usuario, ctx } = await exigirAcesso("irpf.operar");
  const d = await comEscritorio(ctx, async (tx) => {
    const clientes = await tx.cliente.findMany({ where: { AND: [filtroClientes(usuario), { situacao: { not: "ENCERRADO" } }] }, include: { pessoa: { include: { vinculosComoEmpresa: { where: { fim: null }, include: { socio: true } } } } } });
    const opcoes: { valor: string; rotulo: string }[] = [];
    for (const c of clientes) {
      if (c.pessoa.tipo === "PF") opcoes.push({ valor: `${c.pessoaId}|${c.id}`, rotulo: `${c.pessoa.nome} (cliente)` });
      for (const v of c.pessoa.vinculosComoEmpresa) if (v.socio.tipo === "PF") opcoes.push({ valor: `${v.socioId}|${c.id}`, rotulo: `${v.socio.nome} (sócio de ${c.pessoa.nome})` });
    }
    opcoes.sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
    const equipe = await tx.usuario.findMany({ where: { ativo: true, perfil: { in: ["ANALISTA_IRPF", "CONTADOR", "ADMINISTRADOR"] } }, orderBy: { nome: "asc" } });
    return { opcoes, equipe };
  });
  const ano = Number(sp.ano) || hojeSaoPaulo().getUTCFullYear() - 1;
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho"><div className="sobre"><span className="trilha"><Link href="/irpf">IRPF</Link> / Nova</span><h1>Nova declaração</h1></div></div>
      <Formulario acao={acaoNovaDeclaracao} className="cartao campos campos-2">
        <Campo nome="contribuinte" rotulo="Contribuinte" obrigatorio className="ocupa-tudo" opcoes={[{ valor: "", rotulo: "Escolha" }, ...d.opcoes]} ajuda="Clientes pessoa física e sócios dos clientes empresa." />
        <Campo nome="ano" rotulo="Ano-calendário" tipo="number" valor={String(ano)} obrigatorio />
        <Campo nome="responsavelId" rotulo="Responsável" opcoes={[{ valor: "", rotulo: "Ninguém ainda" }, ...d.equipe.map((u) => ({ valor: u.id, rotulo: u.nome }))]} valor={usuario.perfil === "ANALISTA_IRPF" ? usuario.id : ""} />
        <Campo nome="honorario" rotulo="Honorário (R$)" inputMode="decimal" />
        <Campo nome="prazo" rotulo="Prazo interno" tipo="date" ajuda="Em branco: usa o prazo de entrega da tabela do ano, se cadastrado." />
        <div className="ocupa-tudo"><BotaoEnviar>Abrir declaração</BotaoEnviar></div>
      </Formulario>
    </div>
  );
}
