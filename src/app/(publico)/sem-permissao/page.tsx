import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function SemPermissao() {
  return (
    <main className="entrada">
      <div className="caixa-entrada">
        <Logo />
        <div className="cartao pilha">
          <h1>Sem permissão</h1>
          <p>Seu perfil não dá acesso a esta área. Se precisar dela, fale com o administrador do escritório.</p>
          <Link className="botao" href="/">Voltar ao painel</Link>
        </div>
      </div>
    </main>
  );
}
