import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { sessaoAtual } from "@/lib/auth/sessao";
import { acaoSair, acaoVerificar } from "../acoes";

export const metadata: Metadata = { title: "Verificação em duas etapas" };

export default async function Verificacao() {
  const s = await sessaoAtual();
  if (!s) redirect("/entrar");
  if (!s.usuario.totpAtivo) redirect("/entrar/ativar-2fa");
  if (s.doisFatoresOk) redirect("/");
  return (
    <main className="entrada">
      <div className="caixa-entrada">
        <Logo />
        <div className="cartao pilha">
          <div className="pilha" style={{ gap: 4 }}>
            <h1>Código de verificação</h1>
            <p className="suave">Olá, {s.usuario.nome.split(" ")[0]}. Abra o aplicativo autenticador e digite o código de 6 dígitos da SOLUCCINI.</p>
          </div>
          <Formulario acao={acaoVerificar} className="campos">
            <Campo nome="codigo" rotulo="Código" autoComplete="one-time-code" inputMode="numeric" obrigatorio maxLength={12}
              ajuda="Sem o celular? Digite um dos códigos de recuperação (formato xxxx-xxxx)." />
            <BotaoEnviar>Confirmar</BotaoEnviar>
          </Formulario>
          <form action={acaoSair}><button className="botao texto" type="submit">Entrar com outra conta</button></form>
        </div>
      </div>
    </main>
  );
}
