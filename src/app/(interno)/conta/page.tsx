import type { Metadata } from "next";
import { LogOut } from "lucide-react";
import { exigirAcesso } from "@/lib/auth/sessao";
import { NOME_PERFIL } from "@/lib/auth/permissoes";
import { MINIMO_SENHA } from "@/lib/auth/senha";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Selo } from "@/components/Selo";
import { acaoTrocarSenha } from "../equipe/acoes";
import { acaoSair } from "../../(publico)/entrar/acoes";

export const metadata: Metadata = { title: "Minha conta" };

export default async function Conta() {
  const { usuario } = await exigirAcesso();
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre"><h1>Minha conta</h1></div>
        <form action={acaoSair}><button className="botao secundario" type="submit"><LogOut size={18} aria-hidden /> Sair</button></form>
      </div>
      <div className="grade grade-2">
        <section className="cartao">
          <h2>Seus dados</h2>
          <dl className="definicoes">
            <div><dt>Nome</dt><dd>{usuario.nome}</dd></div>
            <div><dt>E-mail</dt><dd>{usuario.email}</dd></div>
            <div><dt>Perfil</dt><dd>{NOME_PERFIL[usuario.perfil]}</dd></div>
            <div><dt>Verificação em duas etapas</dt><dd><Selo tom="positivo">Ativa</Selo></dd></div>
          </dl>
          <p className="suave pequeno" style={{ marginTop: 16 }}>Trocou de celular ou perdeu os códigos de recuperação? Peça ao administrador para redefinir seu acesso.</p>
        </section>
        <section className="cartao">
          <h2>Trocar senha</h2>
          <Formulario acao={acaoTrocarSenha} className="campos" limparAoConcluir>
            <Campo nome="senhaAtual" rotulo="Senha atual" tipo="password" autoComplete="current-password" obrigatorio />
            <Campo nome="novaSenha" rotulo="Nova senha" tipo="password" autoComplete="new-password" obrigatorio ajuda={`Pelo menos ${MINIMO_SENHA} caracteres. Uma frase fácil de lembrar funciona bem.`} />
            <Campo nome="confirmacaoSenha" rotulo="Repita a nova senha" tipo="password" autoComplete="new-password" obrigatorio />
            <BotaoEnviar>Trocar senha</BotaoEnviar>
          </Formulario>
        </section>
      </div>
    </div>
  );
}
