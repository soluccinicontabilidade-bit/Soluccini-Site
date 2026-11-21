import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function NaoEncontrado() {
  return (
    <main className="entrada">
      <div className="caixa-entrada">
        <Logo />
        <div className="cartao pilha">
          <h1>Página não encontrada</h1>
          <p>O endereço pode estar errado ou o item não está disponível para o seu perfil.</p>
          <Link className="botao" href="/">Ir para o painel</Link>
        </div>
      </div>
    </main>
  );
}
