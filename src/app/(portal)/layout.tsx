import Link from "next/link";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/Logo";
import { exigirAcessoPortal } from "@/lib/auth/sessao";
import { acaoSair } from "../(publico)/entrar/acoes";

export const dynamic = "force-dynamic";

export default async function LayoutPortal({ children }: { children: React.ReactNode }) {
  const { usuario } = await exigirAcessoPortal();
  return (
    <div style={{ minHeight: "100dvh" }}>
      <header className="topo-movel" style={{ display: "flex" }}>
        <Link href="/portal" aria-label="Início do portal"><Logo /></Link>
        <div className="linha">
          <span className="pequeno suave">{usuario.nome.split(" ")[0]}</span>
          <form action={acaoSair}><button className="botao secundario pequeno" type="submit"><LogOut size={16} aria-hidden /> Sair</button></form>
        </div>
      </header>
      <main id="conteudo" className="conteudo" style={{ paddingBottom: 48 }}>{children}</main>
    </div>
  );
}
