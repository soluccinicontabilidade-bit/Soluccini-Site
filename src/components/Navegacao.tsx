"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, FileUp, LayoutDashboard, UserCog, Users, UserRound } from "lucide-react";

const ICONES = { painel: LayoutDashboard, clientes: Users, carteiras: Briefcase, equipe: UserCog, importar: FileUp, conta: UserRound };
export type ItemNav = { href: string; rotulo: string; icone: keyof typeof ICONES; curto?: string };

function ativo(caminho: string, href: string) {
  return href === "/" ? caminho === "/" : caminho === href || caminho.startsWith(href + "/");
}

export function NavLateral({ itens }: { itens: ItemNav[] }) {
  const caminho = usePathname();
  return (
    <nav aria-label="Principal">
      {itens.map((i) => {
        const Icone = ICONES[i.icone];
        return (
          <Link key={i.href} href={i.href} aria-current={ativo(caminho, i.href) ? "page" : undefined}>
            <Icone size={20} aria-hidden /> {i.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}

export function NavInferior({ itens }: { itens: ItemNav[] }) {
  const caminho = usePathname();
  return (
    <nav className="navegacao-inferior" aria-label="Principal">
      {itens.slice(0, 5).map((i) => {
        const Icone = ICONES[i.icone];
        return (
          <Link key={i.href} href={i.href} aria-current={ativo(caminho, i.href) ? "page" : undefined}>
            <Icone size={22} aria-hidden />
            {i.curto ?? i.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
