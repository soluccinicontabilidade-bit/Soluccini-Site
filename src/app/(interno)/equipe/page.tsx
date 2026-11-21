import type { Metadata } from "next";
import type { PerfilUsuario } from "@prisma/client";
import { exigirAcesso } from "@/lib/auth/sessao";
import { NOME_PERFIL } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { formatarInstante } from "@/lib/br";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Selo } from "@/components/Selo";
import { acaoAlterarUsuario, acaoCriarUsuario, acaoRedefinirAcesso } from "./acoes";

export const metadata: Metadata = { title: "Equipe" };

const PERFIS = (Object.keys(NOME_PERFIL) as PerfilUsuario[]).map((p) => ({ valor: p, rotulo: NOME_PERFIL[p] }));

export default async function Equipe() {
  const { usuario, ctx } = await exigirAcesso("usuarios.gerenciar");
  const usuarios = await comEscritorio(ctx, (tx) => tx.usuario.findMany({ orderBy: [{ ativo: "desc" }, { nome: "asc" }] }));
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <h1>Equipe e acessos</h1>
          <p className="suave">Quem entra no sistema e com qual perfil. Perfis de cliente só terão uso quando o portal for liberado.</p>
        </div>
      </div>

      <details className="painel-form">
        <summary>Cadastrar pessoa</summary>
        <div>
          <Formulario acao={acaoCriarUsuario} className="campos campos-3" limparAoConcluir>
            <Campo nome="nome" rotulo="Nome" obrigatorio />
            <Campo nome="email" rotulo="E-mail" tipo="email" obrigatorio />
            <Campo nome="perfil" rotulo="Perfil" valor="ANALISTA_BPO" opcoes={PERFIS} />
            <div className="ocupa-tudo"><BotaoEnviar>Cadastrar e gerar senha temporária</BotaoEnviar></div>
          </Formulario>
        </div>
      </details>

      <section className="cartao">
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Pessoa</th><th>Perfil</th><th>Segurança</th><th>Último acesso</th><th></th></tr></thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.nome}</strong><div className="suave pequeno">{u.email}</div></td>
                  <td>{NOME_PERFIL[u.perfil]}{!u.ativo && <> <Selo tom="neutro">Inativo</Selo></>}</td>
                  <td>
                    {u.totpAtivadoEm ? <Selo tom="positivo">Duas etapas ativas</Selo> : <Selo tom="atencao">Aguardando primeiro acesso</Selo>}
                    {u.bloqueadoAte && u.bloqueadoAte > new Date() && <div><Selo tom="erro">Bloqueado por tentativas</Selo></div>}
                  </td>
                  <td className="pequeno">{u.ultimoAcessoEm ? formatarInstante(u.ultimoAcessoEm) : "Nunca"}</td>
                  <td>
                    {u.id !== usuario.id ? (
                      <details className="painel-form">
                        <summary>Alterar</summary>
                        <div className="pilha">
                          <Formulario acao={acaoAlterarUsuario.bind(null, u.id)} className="campos">
                            <Campo nome="perfil" rotulo="Perfil" valor={u.perfil} opcoes={PERFIS} />
                            <Campo nome="ativo" rotulo="Acesso" valor={u.ativo ? "sim" : "nao"} opcoes={[{ valor: "sim", rotulo: "Ativo" }, { valor: "nao", rotulo: "Desativado" }]} />
                            <BotaoEnviar className="pequeno">Salvar</BotaoEnviar>
                          </Formulario>
                          <Formulario acao={acaoRedefinirAcesso.bind(null, u.id)} confirmar={`Gerar nova senha para ${u.nome} e zerar o código do celular?`}>
                            <BotaoEnviar className="secundario pequeno">Redefinir senha e 2FA</BotaoEnviar>
                          </Formulario>
                        </div>
                      </details>
                    ) : <span className="suave pequeno">Você</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
