import Link from "next/link";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/Logo";
import { NavInferior, NavLateral, type ItemNav } from "@/components/Navegacao";
import { exigirAcesso } from "@/lib/auth/sessao";
import { NOME_PERFIL, pode } from "@/lib/auth/permissoes";
import { acaoSair } from "../(publico)/entrar/acoes";

export const dynamic = "force-dynamic";

export default async function LayoutInterno({ children }: { children: React.ReactNode }) {
  const { usuario } = await exigirAcesso();
  const itens: ItemNav[] = [
    { href: "/", rotulo: "Painel", icone: "painel" },
    { href: "/clientes", rotulo: "Clientes", icone: "clientes" },
    ...(pode(usuario.perfil, "importacao.clientes") ? [{ href: "/importacoes", rotulo: "Importar planilhas", curto: "Importar", icone: "importar" as const }] : []),
    ...(pode(usuario.perfil, "carteiras.gerenciar") ? [{ href: "/carteiras", rotulo: "Carteiras", icone: "carteiras" as const }] : []),
    ...(pode(usuario.perfil, "usuarios.gerenciar") ? [{ href: "/equipe", rotulo: "Equipe", icone: "equipe" as const }] : []),
    { href: "/conta", rotulo: "Minha conta", curto: "Conta", icone: "conta" },
  ];
  // No celular cabem 5 itens; Carteiras e Equipe ficam acessíveis pelo painel.
  const inferior = itens.filter((i) => !["/carteiras", "/equipe"].includes(i.href));

  return (
    <div className="app">
      <a href="#conteudo" className="leitor">Ir para o conteúdo</a>
      <aside className="lateral">
        <Link href="/" aria-label="Painel"><Logo /></Link>
        <NavLateral itens={itens} />
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
          <span className="pequeno suave">{usuario.nome.split(" ")[0]}</span>
        </header>
        <main id="conteudo" className="conteudo">{children}</main>
      </div>
      <NavInferior itens={inferior} />
    </div>
  );
}
