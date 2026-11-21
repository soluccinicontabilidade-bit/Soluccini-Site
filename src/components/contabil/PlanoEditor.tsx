import type { ContaContabil } from "@prisma/client";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Selo } from "@/components/Selo";
import { NOME_GRUPO, ordenarContas } from "@/lib/contabil/plano";
import { acaoAtualizarConta, acaoCriarConta } from "@/app/(interno)/contabilidade/acoes";

const NATUREZAS = [{ valor: "DEVEDORA", rotulo: "Devedora" }, { valor: "CREDORA", rotulo: "Credora" }];
const SIM_NAO = [{ valor: "nao", rotulo: "Não" }, { valor: "sim", rotulo: "Sim" }];

export function PlanoEditor({ planoId, contas, editavel }: { planoId: string; contas: ContaContabil[]; editavel: boolean }) {
  const ordenadas = ordenarContas(contas);
  return (
    <div className="pilha">
      {editavel && (
        <details className="painel-form">
          <summary>Nova conta</summary>
          <div>
            <Formulario acao={acaoCriarConta.bind(null, planoId)} className="campos campos-3" limparAoConcluir>
              <Campo nome="codigo" rotulo="Código" obrigatorio placeholder="1.1.1.04" ajuda="A conta-pai (nível acima) precisa existir." />
              <Campo nome="nome" rotulo="Nome" obrigatorio className="ocupa-2" />
              <Campo nome="tipo" rotulo="Tipo" valor="A" opcoes={[{ valor: "A", rotulo: "Analítica (recebe lançamentos)" }, { valor: "S", rotulo: "Sintética (agrupa contas)" }]} />
              <Campo nome="natureza" rotulo="Natureza" valor="" opcoes={[{ valor: "", rotulo: "Igual à conta-pai" }, ...NATUREZAS]} ajuda="Contas redutoras têm natureza oposta à do grupo." />
              <Campo nome="disponivel" rotulo="Caixa e equivalentes?" valor="nao" opcoes={SIM_NAO} ajuda="Só para caixa, bancos e aplicações de liquidez imediata." />
              <Campo nome="referencial" rotulo="Conta referencial (RFB)" ajuda="Opcional. Código do plano referencial, para o SPED." />
              <div className="ocupa-tudo"><BotaoEnviar>Criar conta</BotaoEnviar></div>
            </Formulario>
          </div>
        </details>
      )}
      <section className="cartao">
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Código</th><th>Nome</th><th>Grupo</th><th>Natureza</th><th>Tipo</th>{editavel && <th></th>}</tr></thead>
            <tbody>
              {ordenadas.map((c) => (
                <tr key={c.id} className={c.analitica ? undefined : "linha-subtotal"} style={c.ativa ? undefined : { opacity: 0.6 }}>
                  <td className="tabular">{c.codigo}</td>
                  <td style={{ paddingLeft: 12 + (c.nivel - 1) * 14 }}>
                    {c.analitica ? c.nome : <strong>{c.nome}</strong>}
                    <div className="linha" style={{ gap: 4 }}>
                      {c.disponivel && <span className="etiqueta">Caixa e equivalentes</span>}
                      {c.codigoReferencial && <span className="suave pequeno">Ref. {c.codigoReferencial}</span>}
                      {!c.ativa && <Selo tom="neutro">Inativa</Selo>}
                    </div>
                  </td>
                  <td className="pequeno">{NOME_GRUPO[c.grupo]}</td>
                  <td className="pequeno">{c.natureza === "DEVEDORA" ? "Devedora" : "Credora"}</td>
                  <td className="pequeno">{c.analitica ? "Analítica" : "Sintética"}</td>
                  {editavel && (
                    <td>
                      <details className="painel-form">
                        <summary>Editar</summary>
                        <div>
                          <Formulario acao={acaoAtualizarConta.bind(null, planoId, c.id)} className="campos">
                            <Campo nome="nome" rotulo="Nome" valor={c.nome} obrigatorio />
                            <Campo nome="natureza" rotulo="Natureza" valor={c.natureza} opcoes={NATUREZAS} />
                            {c.analitica && c.grupo === "ATIVO" && <Campo nome="disponivel" rotulo="Caixa e equivalentes?" valor={c.disponivel ? "sim" : "nao"} opcoes={SIM_NAO} />}
                            <Campo nome="referencial" rotulo="Conta referencial (RFB)" valor={c.codigoReferencial} />
                            <Campo nome="ativa" rotulo="Situação" valor={c.ativa ? "sim" : "nao"} opcoes={[{ valor: "sim", rotulo: "Ativa" }, { valor: "nao", rotulo: "Inativa (não recebe novos lançamentos)" }]} />
                            <BotaoEnviar className="pequeno">Salvar</BotaoEnviar>
                          </Formulario>
                        </div>
                      </details>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
