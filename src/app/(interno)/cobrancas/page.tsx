import type { Metadata } from "next";
import Link from "next/link";
import { exigirAcesso } from "@/lib/auth/sessao";
import { filtroClientes } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { formatarData, formatarReais, hojeSaoPaulo, isoData } from "@/lib/br";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Selo } from "@/components/Selo";
import { PixQr } from "@/components/PixQr";
import { acaoCancelarCobranca, acaoCobrancaAvulsa, acaoGerarCobrancas, acaoPagamento } from "../acoes-gestao";

export const metadata: Metadata = { title: "Cobrança de honorários" };

export default async function Cobrancas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { usuario, ctx } = await exigirAcesso("cobranca.gerenciar");
  const hoje = hojeSaoPaulo();
  const ver = sp.ver === "todas" ? "todas" : "pendentes";
  const d = await comEscritorio(ctx, async (tx) => ({
    cobrancas: await tx.cobranca.findMany({ where: { cliente: filtroClientes(usuario), ...(ver === "pendentes" ? { situacao: "PENDENTE" } : {}) }, include: { cliente: { include: { pessoa: { select: { nome: true } } } } }, orderBy: [{ vencimento: "asc" }], take: 300 }),
    clientes: await tx.cliente.findMany({ where: filtroClientes(usuario), include: { pessoa: { select: { nome: true } } }, orderBy: { pessoa: { nome: "asc" } } }),
    cfg: await tx.configEscritorio.findUnique({ where: { escritorioId: usuario.escritorioId } }),
  }));
  const vencidas = d.cobrancas.filter((c) => c.situacao === "PENDENTE" && c.vencimento < hoje);
  const total = (l: typeof d.cobrancas) => l.reduce((s, c) => s + c.valorCentavos, 0n);
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho"><div className="sobre"><h1>Cobrança de honorários</h1><p className="suave">Gerada a partir dos contratos. O cliente paga pelo Pix copia e cola (no portal ou enviado por você) e a baixa é registrada aqui.</p></div></div>
      {!d.cfg?.chavePix && <div className="aviso atencao"><span>Configure a chave Pix do escritório em <Link href="/configuracoes">Configurações</Link> para gerar o Pix copia e cola.</span></div>}
      <section className="grade grade-3">
        <div className="cartao indicador"><span className="rotulo">A receber</span><span className="valor" style={{ fontSize: 22 }}>{formatarReais(total(d.cobrancas.filter((c) => c.situacao === "PENDENTE")))}</span></div>
        <div className="cartao indicador"><span className="rotulo">Vencidas</span><span className="valor" style={{ fontSize: 22 }}>{formatarReais(total(vencidas))}</span><span className="pequeno suave">{vencidas.length} cobrança(s)</span></div>
        <div className="cartao pilha">
          <Formulario acao={acaoGerarCobrancas} className="campos">
            <Campo nome="mes" rotulo="Gerar honorários do mês" tipo="month" valor={isoData(hoje).slice(0, 7)} />
            <BotaoEnviar className="pequeno">Gerar cobranças</BotaoEnviar>
          </Formulario>
        </div>
      </section>
      <div className="linha">
        <Link className={`botao pequeno ${ver === "pendentes" ? "" : "secundario"}`} href="/cobrancas">Pendentes</Link>
        <Link className={`botao pequeno ${ver === "todas" ? "" : "secundario"}`} href="/cobrancas?ver=todas">Todas</Link>
      </div>
      <section className="cartao">
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Cliente</th><th>Vencimento</th><th className="num">Valor</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {d.cobrancas.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/clientes/${c.clienteId}?aba=contrato`}>{c.cliente.pessoa.nome}</Link><div className="pequeno suave">{c.descricao}</div></td>
                  <td>{formatarData(c.vencimento)}</td>
                  <td className="num">{formatarReais(c.valorCentavos)}</td>
                  <td>{c.situacao === "PAGA" ? <Selo tom="positivo">Paga em {formatarData(c.pagaEm)}</Selo> : c.situacao === "CANCELADA" ? <Selo tom="neutro">Cancelada</Selo> : <Selo tom={c.vencimento < hoje ? "erro" : "atencao"}>{c.vencimento < hoje ? "Vencida" : "Pendente"}</Selo>}</td>
                  <td>
                    {c.situacao === "PENDENTE" && (
                      <details className="painel-form"><summary>Abrir</summary><div className="pilha">
                        {c.pixCopiaECola ? (<><PixQr codigo={c.pixCopiaECola} tamanho={150} /><input readOnly value={c.pixCopiaECola} aria-label="Pix copia e cola" /></>) : <p className="pequeno suave">Sem Pix (configure a chave).</p>}
                        <Formulario acao={acaoPagamento.bind(null, c.id)} className="campos">
                          <Campo nome="data" rotulo="Pago em" tipo="date" valor={isoData(hoje)} obrigatorio />
                          <Campo nome="valor" rotulo="Valor pago (R$)" valor={formatarReais(c.valorCentavos).replace("R$ ", "")} />
                          <BotaoEnviar className="pequeno">Registrar pagamento</BotaoEnviar>
                        </Formulario>
                        <Formulario acao={acaoCancelarCobranca.bind(null, c.id)} className="campos">
                          <Campo nome="motivo" rotulo="Cancelar: motivo" />
                          <BotaoEnviar className="perigo pequeno">Cancelar cobrança</BotaoEnviar>
                        </Formulario>
                      </div></details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.cobrancas.length === 0 && <p className="suave">Nenhuma cobrança.</p>}
      </section>
      <details className="painel-form"><summary>Cobrança avulsa</summary><div>
        <Formulario acao={acaoCobrancaAvulsa} className="campos campos-2" limparAoConcluir>
          <Campo nome="clienteId" rotulo="Cliente" opcoes={d.clientes.map((c) => ({ valor: c.id, rotulo: c.pessoa.nome }))} />
          <Campo nome="descricao" rotulo="Descrição" obrigatorio placeholder="Ex.: Declaração de IRPF 2026" />
          <Campo nome="valor" rotulo="Valor (R$)" obrigatorio inputMode="decimal" />
          <Campo nome="vencimento" rotulo="Vencimento" tipo="date" valor={isoData(hoje)} obrigatorio />
          <div className="ocupa-tudo"><BotaoEnviar>Criar cobrança</BotaoEnviar></div>
        </Formulario>
      </div></details>
    </div>
  );
}
