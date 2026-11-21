import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Download } from "lucide-react";
import { exigirAcesso } from "@/lib/auth/sessao";
import { pode } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { formatarData, formatarInstante, formatarReais, isoData } from "@/lib/br";
import { clienteOu404 } from "@/lib/contabil/pagina";
import { NOME_SITUACAO_PARCELA } from "@/lib/financeiro/financeiro";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Selo } from "@/components/Selo";
import { acaoAnexo, acaoCancelarTitulo } from "../../../acoes";

export const metadata: Metadata = { title: "Título" };

export default async function Titulo({ params, searchParams }: { params: Promise<{ clienteId: string; tituloId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { clienteId, tituloId } = await params;
  const sp = await searchParams;
  const acesso = await exigirAcesso("financeiro.ver");
  if (!/^[0-9a-f-]{36}$/i.test(tituloId)) notFound();
  const d = await comEscritorio(acesso.ctx, async (tx) => ({
    cliente: await clienteOu404(tx, acesso, clienteId),
    t: await tx.tituloFinanceiro.findFirst({
      where: { id: tituloId, clienteId },
      include: {
        favorecido: true, parcelas: { orderBy: { numero: "asc" } }, rateios: { include: { categoria: { include: { pai: true } }, centroCusto: true } },
        anexos: { where: { excluidoEm: null }, include: { versoes: { orderBy: { versao: "desc" }, take: 1 } } },
      },
    }),
    usuarios: await tx.usuario.findMany({ select: { id: true, nome: true } }),
  }));
  if (!d.t) notFound();
  const t = d.t;
  const nome = (id: string | null) => d.usuarios.find((u) => u.id === id)?.nome ?? "";
  const operar = pode(acesso.usuario.perfil, "financeiro.operar");
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <span className="trilha"><Link href="/financeiro">Financeiro</Link> / <Link href={`/financeiro/${clienteId}`}>{d.cliente.pessoa.nome}</Link></span>
          <h1>{t.descricao}</h1>
          <div className="linha">
            <span className="etiqueta">{t.tipo === "PAGAR" ? "A pagar" : "A receber"}</span>
            {t.canceladoEm && <Selo tom="neutro">Cancelado: {t.motivoCancelamento}</Selo>}
            {t.grupoRecorrencia && <span className="etiqueta">Recorrente</span>}
          </div>
        </div>
      </div>
      {sp.criado && <div className="aviso positivo" role="status"><Check size={20} aria-hidden /> Título criado.</div>}
      <section className="cartao">
        <dl className="definicoes">
          <div><dt>Valor</dt><dd className="num"><strong>{formatarReais(t.valorCentavos)}</strong></dd></div>
          <div><dt>Competência</dt><dd>{formatarData(t.competencia)}</dd></div>
          <div><dt>{t.tipo === "PAGAR" ? "Fornecedor" : "Cliente"}</dt><dd>{t.favorecido?.nome ?? "Não informado"}</dd></div>
          {t.documento && <div><dt>Documento</dt><dd>{t.documento}</dd></div>}
          {t.observacao && <div style={{ gridColumn: "1 / -1" }}><dt>Observação</dt><dd>{t.observacao}</dd></div>}
        </dl>
      </section>
      <section className="cartao">
        <h2>Categorias</h2>
        <table><tbody>{t.rateios.map((r) => <tr key={r.id}><td>{r.categoria.pai?.nome} › {r.categoria.nome}{r.centroCusto && <span className="suave pequeno"> · {r.centroCusto.nome}</span>}</td><td className="num">{formatarReais(r.valorCentavos)}</td></tr>)}</tbody></table>
      </section>
      <section className="cartao">
        <h2>Parcelas</h2>
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Nº</th><th>Vencimento</th><th>Situação</th><th className="num">Valor</th><th>Baixa</th></tr></thead>
            <tbody>
              {t.parcelas.map((p) => (
                <tr key={p.id}>
                  <td>{p.numero}/{p.total}</td>
                  <td>{formatarData(p.vencimento)}</td>
                  <td><Selo tom={p.situacao === "BAIXADA" ? "positivo" : p.situacao === "REPROVADA" ? "erro" : "neutro"}>{NOME_SITUACAO_PARCELA[p.situacao]}</Selo>
                    {p.aprovadoEm && <div className="pequeno suave">Aprovado em {formatarInstante(p.aprovadoEm)} por {nome(p.aprovadoPorId)}</div>}</td>
                  <td className="num">{formatarReais(p.valorCentavos)}</td>
                  <td className="pequeno">{p.dataBaixa ? `${formatarData(p.dataBaixa)} · ${formatarReais(p.valorBaixaCentavos!)}${p.jurosCentavos + p.multaCentavos > 0n ? ` (juros/multa ${formatarReais(p.jurosCentavos + p.multaCentavos)})` : ""}${p.descontoCentavos > 0n ? ` (desconto ${formatarReais(p.descontoCentavos)})` : ""}${p.conciliacaoId ? " · conciliada" : ""}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="cartao pilha">
        <h2>Anexos</h2>
        {t.anexos.length === 0 ? <p className="suave">Nenhum anexo (boleto, nota, comprovante).</p> : (
          <ul>{t.anexos.map((a) => <li key={a.id}>{a.versoes[0] && <a href={`/api/documentos/${a.versoes[0].id}`}><Download size={14} aria-hidden /> {a.titulo}</a>}</li>)}</ul>
        )}
        {operar && (
          <Formulario acao={acaoAnexo.bind(null, clienteId, t.id)} className="linha" limparAoConcluir>
            <input type="file" name="arquivo" aria-label="Arquivo do anexo" accept=".pdf,.png,.jpg,.jpeg,.xml" style={{ flex: 1 }} />
            <BotaoEnviar className="secundario pequeno">Anexar</BotaoEnviar>
          </Formulario>
        )}
      </section>
      {operar && !t.canceladoEm && !t.parcelas.some((p) => p.situacao === "BAIXADA") && (
        <details className="painel-form">
          <summary>Cancelar título</summary>
          <div>
            <Formulario acao={acaoCancelarTitulo.bind(null, clienteId, t.id)} className="campos" confirmar="Cancelar este título e todas as parcelas?">
              <Campo nome="motivo" rotulo="Motivo" obrigatorio />
              <BotaoEnviar className="perigo">Cancelar título</BotaoEnviar>
            </Formulario>
          </div>
        </details>
      )}
      <p className="suave pequeno">Criado em {formatarInstante(t.criadoEm)} por {nome(t.criadoPorId)} · competência {isoData(t.competencia).slice(0, 7)}</p>
    </div>
  );
}
