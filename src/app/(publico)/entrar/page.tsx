import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { sessaoAtual } from "@/lib/auth/sessao";
import { acaoEntrar } from "./acoes";

export const metadata: Metadata = { title: "Entrar" };

export default async function Entrar({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
  const { motivo } = await searchParams;
  const s = await sessaoAtual();
  if (s?.doisFatoresOk && motivo !== "portal") redirect("/");
  return (
    <main className="entrada">
      <div className="caixa-entrada">
        <Logo />
        <div className="cartao pilha">
          <div className="pilha" style={{ gap: 4 }}>
            <h1>Entrar</h1>
            <p className="suave">Use o e-mail e a senha cadastrados pelo escritório.</p>
          </div>
          {motivo === "portal" && (
            <div className="aviso info" role="status">O portal do cliente ainda não está disponível. Em breve você poderá acompanhar tudo por aqui.</div>
          )}
          <Formulario acao={acaoEntrar} className="campos">
            <Campo nome="email" rotulo="E-mail" tipo="email" autoComplete="username" inputMode="email" obrigatorio />
            <Campo nome="senha" rotulo="Senha" tipo="password" autoComplete="current-password" obrigatorio />
            <BotaoEnviar>Entrar</BotaoEnviar>
          </Formulario>
          <p className="pequeno suave">Esqueceu a senha ou trocou de celular? Peça ao administrador do escritório para redefinir seu acesso.</p>
        </div>
        <p className="slogan">Solucionando problemas, entregando resultados.</p>
      </div>
    </main>
  );
}
