import Link from "next/link";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/Logo";
import { NavInferior, NavLateral, type ItemNav } from "@/components/Navegacao";
import { exigirAcesso } from "@/lib/auth/sessao";
import { NOME_PERFIL, pode } from "@/lib/auth/permissoes";
import { acaoSair } from "../(publico)/entrar/acoes";
import { comEscritorio } from "@/lib/db";
import { Bell } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LayoutInterno({ children }: { children: React.ReactNode }) {
  const { usuario, ctx } = await exigirAcesso();
  const itens: ItemNav[] = [
    { href: "/", rotulo: "Painel", icone: "painel" },
    { href: "/clientes", rotulo: "Clientes", icone: "clientes" },
    { href: "/financeiro", rotulo: "Financeiro (BPO)", curto: "Financeiro", icone: "financeiro" },
    { href: "/contabilidade", rotulo: "Contabilidade", curto: "Contábil", icone: "contabil" },
    { href: "/irpf", rotulo: "IRPF", icone: "irpf" },
    { href: "/tarefas", rotulo: "Tarefas", icone: "tarefas" },
    ...(pode(usuario.perfil, "cobranca.gerenciar") ? [{ href: "/cobrancas", rotulo: "Honorários", icone: "cobranca" as const }] : []),
    ...(pode(usuario.perfil, "importacao.clientes") ? [{ href: "/importacoes", rotulo: "Importar planilhas", curto: "Importar", icone: "importar" as const }] : []),
    ...(pode(usuario.perfil, "carteiras.gerenciar") ? [{ href: "/carteiras", rotulo: "Carteiras", icone: "carteiras" as const }] : []),
    ...(pode(usuario.perfil, "usuarios.gerenciar") ? [{ href: "/equipe", rotulo: "Equipe", icone: "equipe" as const }] : []),
    ...(pode(usuario.perfil, "configuracoes") ? [{ href: "/configuracoes", rotulo: "Configurações", icone: "config" as const }] : []),
    { href: "/conta", rotulo: "Minha conta", curto: "Conta", icone: "conta" },
  ];
  const naoLidas = await comEscritorio(ctx, (tx) => tx.notificacao.count({ where: { usuarioId: usuario.id, lidaEm: null } }));
  // No celular cabem 5 itens; Carteiras e Equipe ficam acessíveis pelo painel.
  // No celular cabem 5 itens: os mais usados por cada perfil. O resto fica no painel e na lateral.
  const prioridade: Record<string, string[]> = {
    ANALISTA_IRPF: ["/", "/clientes", "/irpf", "/contabilidade", "/conta"],
    ANALISTA_BPO: ["/", "/clientes", "/financeiro", "/contabilidade", "/conta"],
  };
  const escolhidos = prioridade[usuario.perfil] ?? ["/", "/clientes", "/financeiro", "/contabilidade", "/conta"];
  const inferior = escolhidos.map((h) => itens.find((i) => i.href === h)).filter((i): i is ItemNav => !!i);

  return (
    <div className="app">
      <a href="#conteudo" className="leitor">Ir para o conteúdo</a>
      <aside className="lateral">
        <Link href="/" aria-label="Painel"><Logo /></Link>
        <NavLateral itens={itens} />
        <Link href="/notificacoes" className="botao secundario pequeno" style={{ justifySelf: "start" }}><Bell size={16} aria-hidden /> Avisos{naoLidas ? ` (${naoLidas})` : ""}</Link>
        <div className="rodape">
          <div>
            <strong>{usuario.nome}</strong>
            <div className="suave pequeno">{NOME_PERFIL[usuario.perfil]}</div>
          </div>
          <form action={acaoSair}>
            <button className="botao secundario pequeno" type="submit"><LogOut size={16} aria-hidden /> Sair</button>
          </form>
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        <header className="topo-movel">
          <Link href="/" aria-label="Painel"><Logo /></Link>
          <Link href="/notificacoes" className="pequeno" aria-label={`Avisos${naoLidas ? `: ${naoLidas} não lidos` : ""}`}><Bell size={20} aria-hidden />{naoLidas ? ` ${naoLidas}` : ""}</Link>
        </header>
        <main id="conteudo" className="conteudo">{children}</main>
      </div>
      <NavInferior itens={inferior} />
    </div>
  );
}
