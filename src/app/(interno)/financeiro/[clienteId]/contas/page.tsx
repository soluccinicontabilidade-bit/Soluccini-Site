import type { Metadata } from "next";
import Link from "next/link";
import type { TipoContaBancaria } from "@prisma/client";
import { exigirAcesso } from "@/lib/auth/sessao";
import { pode } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { formatarData, formatarInstante, formatarReais, hojeSaoPaulo, isoData } from "@/lib/br";
import { clienteOu404 } from "@/lib/contabil/pagina";
import { NOME_TIPO_CONTA, saldoDaConta } from "@/lib/financeiro/financeiro";
import { CabecalhoFinanceiro } from "@/components/financeiro/Cabecalho";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { acaoImportarOfx, acaoNovaConta, acaoTransferencia } from "../../acoes";

export const metadata: Metadata = { title: "Contas bancárias" };

export default async function Contas({ params }: { params: Promise<{ clienteId: string }> }) {
  const { clienteId } = await params;
  const acesso = await exigirAcesso("financeiro.ver");
  const hoje = hojeSaoPaulo();
  const d = await comEscritorio(acesso.ctx, async (tx) => {
    const contas = await tx.contaBancaria.findMany({ where: { clienteId }, include: { contaContabil: true, extratos: { orderBy: { criadoEm: "desc" }, take: 3 } }, orderBy: { nome: "asc" } });
    return {
      cliente: await clienteOu404(tx, acesso, clienteId),
      contas: await Promise.all(contas.map(async (c) => ({ c, saldo: await saldoDaConta(tx, c.id, hoje) }))),
      contabeis: await tx.contaContabil.findMany({ where: { plano: { clienteId }, analitica: true, disponivel: true, contaBancarias: { none: {} } }, orderBy: { codigo: "asc" } }),
      transferencias: await tx.transferencia.findMany({ where: { clienteId, canceladaEm: null }, orderBy: { data: "desc" }, take: 10 }),
    };
  });
  const nomeConta = (id: string) => d.contas.find((x) => x.c.id === id)?.c.nome ?? "";
  const operar = pode(acesso.usuario.perfil, "financeiro.operar");
  const config = pode(acesso.usuario.perfil, "financeiro.config");
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <CabecalhoFinanceiro clienteId={clienteId} nome={d.cliente.pessoa.nome} codigo={d.cliente.codigo} atual="/contas" />
      {d.contas.length === 0 && <div className="cartao vazio"><p>Nenhuma conta cadastrada.</p></div>}
      <div className="grade grade-2">
        {d.contas.map(({ c, saldo }) => (
          <section key={c.id} className="cartao pilha">
            <header>
              <div><h2>{c.nome}</h2><p className="suave pequeno">{NOME_TIPO_CONTA[c.tipo]}{c.numero ? ` · ag. ${c.agencia ?? "-"} cc ${c.numero}` : ""}</p></div>
              <div className="indicador" style={{ textAlign: "right" }}><span className="rotulo">Saldo hoje</span><span className="valor" style={{ fontSize: 22 }}>{formatarReais(saldo)}</span></div>
            </header>
            <p className="pequeno suave">Saldo inicial {formatarReais(c.saldoInicialCentavos)} em {formatarData(c.dataSaldoInicial)} · {c.contaContabil ? `contabilidade: ${c.contaContabil.codigo} ${c.contaContabil.nome}` : "sem conta contábil ligada"}</p>
            {operar && (
              <Formulario acao={acaoImportarOfx.bind(null, clienteId, c.id)} className="linha">
                <input type="file" name="arquivo" accept=".ofx" aria-label={`Extrato OFX de ${c.nome}`} style={{ flex: 1, minWidth: 180 }} />
                <BotaoEnviar className="pequeno">Importar extrato OFX</BotaoEnviar>
              </Formulario>
            )}
            {c.extratos.length > 0 && (
              <ul className="pequeno" style={{ margin: 0 }}>
                {c.extratos.map((e) => <li key={e.id}>{e.nomeOriginal}: {e.novas} nova(s), {e.repetidas} repetida(s) · {formatarInstante(e.criadoEm)}</li>)}
              </ul>
            )}
            <Link className="botao secundario pequeno" href={`/financeiro/${clienteId}/conciliacao?conta=${c.id}`} style={{ justifySelf: "start" }}>Conciliar</Link>
          </section>
        ))}
      </div>
      {operar && d.contas.length >= 2 && (
        <details className="painel-form">
          <summary>Transferência entre contas</summary>
          <div>
            <Formulario acao={acaoTransferencia.bind(null, clienteId)} className="campos campos-3" limparAoConcluir>
              <Campo nome="origemId" rotulo="Sai de" opcoes={d.contas.map(({ c }) => ({ valor: c.id, rotulo: c.nome }))} />
              <Campo nome="destinoId" rotulo="Entra em" valor={d.contas[1].c.id} opcoes={d.contas.map(({ c }) => ({ valor: c.id, rotulo: c.nome }))} />
              <Campo nome="valor" rotulo="Valor (R$)" obrigatorio inputMode="decimal" />
              <Campo nome="data" rotulo="Data" tipo="date" valor={isoData(hoje)} obrigatorio />
              <Campo nome="descricao" rotulo="Descrição" className="ocupa-2" />
              <div className="ocupa-tudo"><BotaoEnviar>Registrar transferência</BotaoEnviar></div>
            </Formulario>
            {d.transferencias.length > 0 && <ul className="pequeno">{d.transferencias.map((t) => <li key={t.id}>{formatarData(t.data)} · {nomeConta(t.origemId)} → {nomeConta(t.destinoId)} · {formatarReais(t.valorCentavos)}</li>)}</ul>}
          </div>
        </details>
      )}
      {config && (
        <details className="painel-form" open={d.contas.length === 0}>
          <summary>Nova conta</summary>
          <div>
            <Formulario acao={acaoNovaConta.bind(null, clienteId)} className="campos campos-3" limparAoConcluir>
              <Campo nome="nome" rotulo="Nome" obrigatorio placeholder="Ex.: Itaú movimento" />
              <Campo nome="tipo" rotulo="Tipo" valor="CORRENTE" opcoes={(Object.keys(NOME_TIPO_CONTA) as TipoContaBancaria[]).map((t) => ({ valor: t, rotulo: NOME_TIPO_CONTA[t] }))} />
              <Campo nome="bancoCodigo" rotulo="Código do banco" placeholder="341" />
              <Campo nome="agencia" rotulo="Agência" />
              <Campo nome="numero" rotulo="Conta" ajuda="Conferimos com o número do extrato OFX." />
              <Campo nome="saldoInicial" rotulo="Saldo inicial (R$)" valor="0,00" inputMode="decimal" ajuda="Negativo com sinal: -1.000,00" />
              <Campo nome="dataSaldoInicial" rotulo="Data do saldo inicial" tipo="date" valor={`${isoData(hoje).slice(0, 8)}01`} obrigatorio ajuda="Transações anteriores a esta data são ignoradas." />
              <Campo nome="contaContabilId" rotulo="Conta contábil" opcoes={[{ valor: "", rotulo: "Nenhuma (ligar depois)" }, ...d.contabeis.map((c) => ({ valor: c.id, rotulo: `${c.codigo} ${c.nome}` }))]} ajuda="Contas de caixa e equivalentes ainda não ligadas." className="ocupa-2" />
              <div className="ocupa-tudo"><BotaoEnviar>Cadastrar conta</BotaoEnviar></div>
            </Formulario>
          </div>
        </details>
      )}
    </div>
  );
}
