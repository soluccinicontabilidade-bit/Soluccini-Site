import type { Metadata } from "next";
import { exigirAcesso } from "@/lib/auth/sessao";
import { pode } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { hojeSaoPaulo, isoData } from "@/lib/br";
import { clienteOu404 } from "@/lib/contabil/pagina";
import { ordenarContas } from "@/lib/contabil/plano";
import { CabecalhoFinanceiro } from "@/components/financeiro/Cabecalho";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { acaoAtualizarCategoria, acaoCategoriasPadrao, acaoConfig, acaoNovaCategoria, acaoNovoCentro, acaoSincronizar } from "../../acoes";

export const metadata: Metadata = { title: "Cadastros do financeiro" };

const ESPECIAL = [{ valor: "NENHUMA", rotulo: "Nenhuma" }, { valor: "PRO_LABORE", rotulo: "Pró-labore (IRPF do sócio)" }, { valor: "DISTRIBUICAO_LUCROS", rotulo: "Distribuição de lucros (IRPF do sócio)" }];

export default async function Cadastros({ params }: { params: Promise<{ clienteId: string }> }) {
  const { clienteId } = await params;
  const acesso = await exigirAcesso("financeiro.ver");
  const d = await comEscritorio(acesso.ctx, async (tx) => ({
    cliente: await clienteOu404(tx, acesso, clienteId),
    categorias: await tx.categoriaFinanceira.findMany({ where: { clienteId }, include: { contaContabil: true }, orderBy: { ordem: "asc" } }),
    centros: await tx.centroDeCusto.findMany({ where: { clienteId }, orderBy: { nome: "asc" } }),
    contas: ordenarContas(await tx.contaContabil.findMany({ where: { plano: { clienteId }, analitica: true, ativa: true } })),
    cfg: await tx.configFinanceira.findUnique({ where: { clienteId } }),
  }));
  const config = pode(acesso.usuario.perfil, "financeiro.config");
  const opContas = [{ valor: "", rotulo: "Não ligada" }, ...d.contas.map((c) => ({ valor: c.id, rotulo: `${c.codigo} ${c.nome}` }))];
  const grupos = d.categorias.filter((c) => !c.paiId);
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <CabecalhoFinanceiro clienteId={clienteId} nome={d.cliente.pessoa.nome} codigo={d.cliente.codigo} atual="/cadastros" />
      <section className="cartao pilha">
        <h2>Categorias (plano gerencial)</h2>
        {d.categorias.length === 0 ? (
          config ? <Formulario acao={acaoCategoriasPadrao.bind(null, clienteId)}><BotaoEnviar>Criar categorias padrão</BotaoEnviar></Formulario> : <p>Sem categorias.</p>
        ) : (
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Categoria</th><th>Conta contábil</th><th>Uso no IRPF</th>{config && <th></th>}</tr></thead>
              <tbody>
                {grupos.flatMap((g) => [g, ...d.categorias.filter((c) => c.paiId === g.id)]).map((c) => (
                  <tr key={c.id} className={c.paiId ? undefined : "linha-subtotal"} style={c.ativa ? undefined : { opacity: 0.6 }}>
                    <td style={{ paddingLeft: c.paiId ? 26 : 12 }}>{c.nome}{!c.paiId && <span className="suave pequeno"> · {c.tipo === "RECEITA" ? "receita" : "despesa"}</span>}</td>
                    <td className="pequeno">{c.contaContabil ? `${c.contaContabil.codigo} ${c.contaContabil.nome}` : c.paiId ? <span className="suave">não ligada</span> : ""}</td>
                    <td className="pequeno">{c.especial !== "NENHUMA" ? ESPECIAL.find((e) => e.valor === c.especial)!.rotulo : ""}</td>
                    {config && <td>{c.paiId && (
                      <details className="painel-form"><summary>Editar</summary><div>
                        <Formulario acao={acaoAtualizarCategoria.bind(null, clienteId, c.id)} className="campos">
                          <Campo nome="nome" rotulo="Nome" valor={c.nome} />
                          <Campo nome="contaContabilId" rotulo="Conta contábil" valor={c.contaContabilId ?? ""} opcoes={opContas} />
                          <Campo nome="especial" rotulo="Uso no IRPF" valor={c.especial} opcoes={ESPECIAL} />
                          <Campo nome="ativa" rotulo="Situação" valor={c.ativa ? "sim" : "nao"} opcoes={[{ valor: "sim", rotulo: "Ativa" }, { valor: "nao", rotulo: "Inativa" }]} />
                          <BotaoEnviar className="pequeno">Salvar</BotaoEnviar>
                        </Formulario>
                      </div></details>
                    )}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {config && d.categorias.length > 0 && (
          <details className="painel-form"><summary>Nova categoria ou grupo</summary><div>
            <Formulario acao={acaoNovaCategoria.bind(null, clienteId)} className="campos campos-3" limparAoConcluir>
              <Campo nome="nome" rotulo="Nome" obrigatorio />
              <Campo nome="paiId" rotulo="Dentro do grupo" opcoes={[{ valor: "", rotulo: "Nenhum (criar grupo)" }, ...grupos.map((g) => ({ valor: g.id, rotulo: g.nome }))]} />
              <Campo nome="tipo" rotulo="Tipo (para grupo novo)" opcoes={[{ valor: "DESPESA", rotulo: "Despesa" }, { valor: "RECEITA", rotulo: "Receita" }]} />
              <div className="ocupa-tudo"><BotaoEnviar>Criar</BotaoEnviar></div>
            </Formulario>
          </div></details>
        )}
      </section>
      <section className="cartao pilha">
        <h2>Centros de custo</h2>
        <p>{d.centros.length ? d.centros.map((c) => c.nome).join(", ") : <span className="suave">Nenhum.</span>}</p>
        {config && <Formulario acao={acaoNovoCentro.bind(null, clienteId)} className="linha" limparAoConcluir><input name="nome" aria-label="Novo centro de custo" placeholder="Ex.: Loja centro" style={{ flex: 1 }} /><BotaoEnviar className="secundario pequeno">Adicionar</BotaoEnviar></Formulario>}
      </section>
      {config && (
        <section className="cartao pilha">
          <h2>Conciliação e integração contábil</h2>
          <Formulario acao={acaoConfig.bind(null, clienteId)} className="campos campos-2">
            <Campo nome="toleranciaDias" rotulo="Tolerância de datas (dias)" tipo="number" valor={String(d.cfg?.toleranciaDias ?? 3)} ajuda="Diferença aceita entre a data do banco e a do sistema." />
            <Campo nome="limiteAutomatico" rotulo="Conciliar sozinho a partir da confiança" tipo="number" valor={String(d.cfg?.limiteAutomatico ?? 95)} ajuda="0 a 100. Use 101 para nunca conciliar sozinho." />
            <Campo nome="contaFornecedoresId" rotulo="Fornecedores (competência)" valor={d.cfg?.contaFornecedoresId ?? ""} opcoes={opContas} />
            <Campo nome="contaClientesId" rotulo="Clientes (competência)" valor={d.cfg?.contaClientesId ?? ""} opcoes={opContas} />
            <Campo nome="contaJurosPagosId" rotulo="Juros e multas pagos" valor={d.cfg?.contaJurosPagosId ?? ""} opcoes={opContas} />
            <Campo nome="contaJurosRecebidosId" rotulo="Juros e multas recebidos" valor={d.cfg?.contaJurosRecebidosId ?? ""} opcoes={opContas} />
            <Campo nome="contaDescontosObtidosId" rotulo="Descontos obtidos" valor={d.cfg?.contaDescontosObtidosId ?? ""} opcoes={opContas} />
            <Campo nome="contaDescontosConcedidosId" rotulo="Descontos concedidos" valor={d.cfg?.contaDescontosConcedidosId ?? ""} opcoes={opContas} />
            <div className="ocupa-tudo"><BotaoEnviar>Salvar configuração</BotaoEnviar></div>
          </Formulario>
        </section>
      )}
      {pode(acesso.usuario.perfil, "contabil.lancar") && (
        <section className="cartao pilha">
          <h2>Contabilizar o financeiro</h2>
          <p className="pequeno">Gera na contabilidade os lançamentos do mês ({d.cliente.regimeContabil === "CAIXA" ? "regime de caixa: só pagamentos e recebimentos" : "regime de competência: provisão na emissão e liquidação na baixa"}). Pode rodar de novo: só cria o que falta e estorna o que mudou. O mês contábil precisa estar aberto.</p>
          <Formulario acao={acaoSincronizar.bind(null, clienteId)} className="linha">
            <label htmlFor="mes-sinc" className="leitor">Mês</label>
            <input id="mes-sinc" name="mes" type="month" defaultValue={isoData(hojeSaoPaulo()).slice(0, 7)} />
            <BotaoEnviar className="secundario">Contabilizar mês</BotaoEnviar>
          </Formulario>
        </section>
      )}
    </div>
  );
}
