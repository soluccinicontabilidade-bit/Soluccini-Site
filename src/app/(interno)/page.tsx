import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Briefcase, FileWarning, ListChecks, Plus, UserCog, Users } from "lucide-react";
import { exigirAcesso } from "@/lib/auth/sessao";
import { filtroClientes, pode } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { formatarData, formatarReais, hojeSaoPaulo } from "@/lib/br";
import { valorVigente } from "@/lib/clientes";
import { Selo } from "@/components/Selo";

export const metadata: Metadata = { title: "Painel" };

export default async function Painel() {
  const { usuario, ctx } = await exigirAcesso();
  const hoje = hojeSaoPaulo();
  const em30 = new Date(hoje.getTime() + 30 * 86400_000);
  const filtro = filtroClientes(usuario);

  const d = await comEscritorio(ctx, async (tx) => {
    const [porSituacao, emEntrada, vencendo, contratos, carteiras] = await Promise.all([
      tx.cliente.groupBy({ by: ["situacao"], where: filtro, _count: true }),
      tx.cliente.findMany({
        where: { AND: [filtro, { situacao: "EM_ENTRADA" }] },
        include: { pessoa: { select: { nome: true } }, _count: { select: { checklistEntrada: { where: { concluidoEm: null } } } } },
        orderBy: { criadoEm: "asc" },
        take: 8,
      }),
      tx.documento.findMany({
        where: { excluidoEm: null, validoAte: { lte: em30 }, cliente: filtro },
        include: { cliente: { include: { pessoa: { select: { nome: true } } } }, categoria: true },
        orderBy: { validoAte: "asc" },
        take: 10,
      }),
      pode(usuario.perfil, "contratos.editar")
        ? tx.contrato.findMany({ where: { fim: null, excluidoEm: null, cliente: filtro }, include: { valores: true } })
        : Promise.resolve([]),
      usuario.perfil === "ADMINISTRADOR" || usuario.perfil === "CONTADOR"
        ? tx.carteira.findMany({ include: { responsavel: { select: { nome: true } }, _count: { select: { clientes: true } } }, orderBy: { nome: "asc" } })
        : Promise.resolve([]),
    ]);
    const ids = (await tx.cliente.findMany({ where: filtro, select: { id: true } })).map((c) => c.id);
    const mesAtual = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));
    const extras = {
      tarefas: await tx.tarefa.findMany({ where: { concluidaEm: null, prazo: { lte: new Date(hoje.getTime() + 7 * 86400_000) }, OR: [{ responsavelId: usuario.id }, { responsavelId: null }], AND: [{ OR: [{ clienteId: null }, { clienteId: { in: ids } }] }] }, include: { cliente: { include: { pessoa: { select: { nome: true } } } } }, orderBy: { prazo: "asc" }, take: 8 }),
      conciliar: await tx.transacaoBancaria.groupBy({ by: ["clienteId"], where: { clienteId: { in: ids }, situacao: { in: ["PENDENTE", "SUGERIDA"] } }, _count: true }),
      periodos: await tx.periodoContabil.count({ where: { clienteId: { in: ids }, situacao: { not: "FECHADO" }, competencia: { lt: mesAtual } } }),
      irpf: await tx.declaracaoIRPF.groupBy({ by: ["situacao"], where: { clienteId: { in: ids }, anoCalendario: hoje.getUTCFullYear() - 1 }, _count: true }),
      cobrancas: pode(usuario.perfil, "cobranca.gerenciar") ? await tx.cobranca.findMany({ where: { situacao: "PENDENTE", clienteId: { in: ids } }, select: { valorCentavos: true, vencimento: true } }) : [],
    };
    return { porSituacao, emEntrada, vencendo, contratos, carteiras, extras };
  });
  const aReceber = d.extras.cobrancas.reduce((s, c) => s + c.valorCentavos, 0n);
  const vencidasCob = d.extras.cobrancas.filter((c) => c.vencimento < hoje).reduce((s, c) => s + c.valorCentavos, 0n);
  const transacoesPendentes = d.extras.conciliar.reduce((s, x) => s + x._count, 0);

  const total = (s: string) => d.porSituacao.find((x) => x.situacao === s)?._count ?? 0;
  const honorarios = d.contratos.reduce((s, c) => s + (valorVigente(c.valores, hoje)?.valorCentavos ?? 0n), 0n);
  const vencidos = d.vencendo.filter((v) => v.validoAte! < hoje);

  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <h1>Olá, {usuario.nome.split(" ")[0]}.</h1>
          <p className="suave">Veja o que pede atenção hoje, {formatarData(hoje)}.</p>
        </div>
        {pode(usuario.perfil, "clientes.criar") && (
          <Link className="botao" href="/clientes/novo"><Plus size={18} aria-hidden /> Cadastrar cliente</Link>
        )}
      </div>

      <section className="grade grade-4" aria-label="Indicadores">
        <div className="cartao indicador"><span className="rotulo">Clientes ativos</span><span className="valor">{total("ATIVO")}</span></div>
        <div className="cartao indicador"><span className="rotulo">Em entrada</span><span className="valor">{total("EM_ENTRADA")}</span></div>
        <div className="cartao indicador"><span className="rotulo">Documentos vencidos ou a vencer em 30 dias</span><span className="valor">{d.vencendo.length}</span></div>
        {pode(usuario.perfil, "contratos.editar") && (
          <div className="cartao indicador"><span className="rotulo">Honorários mensais vigentes</span><span className="valor">{formatarReais(honorarios)}</span></div>
        )}
      </section>

      <section className="grade grade-4" aria-label="Pendências do escritório">
        <Link href="/tarefas" className="cartao indicador" style={{ textDecoration: "none" }}><span className="rotulo">Minhas tarefas nos próximos 7 dias</span><span className="valor">{d.extras.tarefas.length}</span></Link>
        <Link href="/financeiro" className="cartao indicador" style={{ textDecoration: "none" }}><span className="rotulo">Transações bancárias a conciliar</span><span className="valor">{transacoesPendentes}</span></Link>
        <Link href="/contabilidade" className="cartao indicador" style={{ textDecoration: "none" }}><span className="rotulo">Meses anteriores ainda não fechados</span><span className="valor">{d.extras.periodos}</span></Link>
        {pode(usuario.perfil, "cobranca.gerenciar")
          ? <Link href="/cobrancas" className="cartao indicador" style={{ textDecoration: "none" }}><span className="rotulo">Honorários a receber (vencidos)</span><span className="valor" style={{ fontSize: 20 }}>{formatarReais(aReceber)}</span><span className="pequeno suave">{formatarReais(vencidasCob)} vencidos</span></Link>
          : <Link href="/irpf" className="cartao indicador" style={{ textDecoration: "none" }}><span className="rotulo">IRPF {hoje.getUTCFullYear() - 1} em andamento</span><span className="valor">{d.extras.irpf.filter((x) => x.situacao !== "FINALIZADA" && x.situacao !== "TRANSMITIDA").reduce((s, x) => s + x._count, 0)}</span></Link>}
      </section>

      {d.extras.tarefas.length > 0 && (
        <section className="cartao">
          <header><h2>Tarefas da semana</h2><Link className="botao secundario pequeno" href="/tarefas">Ver todas</Link></header>
          <ul className="pilha" style={{ listStyle: "none", padding: 0, margin: 0, gap: 8 }}>
            {d.extras.tarefas.map((t) => <li key={t.id} className="linha" style={{ justifyContent: "space-between" }}><span>{t.titulo}{t.cliente && <span className="suave pequeno"> · {t.cliente.pessoa.nome}</span>}</span><Selo tom={t.prazo < hoje ? "erro" : "atencao"}>{formatarData(t.prazo)}</Selo></li>)}
          </ul>
        </section>
      )}

      <div className="grade grade-2">
        <section className="cartao">
          <header><h2><FileWarning size={20} aria-hidden style={{ verticalAlign: "-3px" }} /> Documentos a renovar</h2></header>
          {d.vencendo.length === 0 ? (
            <p className="suave">Nenhum documento vence nos próximos 30 dias.</p>
          ) : (
            <ul className="pilha" style={{ listStyle: "none", padding: 0, margin: 0, gap: 12 }}>
              {d.vencendo.map((doc) => (
                <li key={doc.id} className="linha" style={{ justifyContent: "space-between" }}>
                  <span>
                    <Link href={`/clientes/${doc.clienteId}?aba=documentos`}>{doc.cliente.pessoa.nome}</Link>
                    <span className="suave pequeno"> · {doc.titulo}</span>
                  </span>
                  <Selo tom={doc.validoAte! < hoje ? "erro" : "atencao"}>{doc.validoAte! < hoje ? "Venceu" : "Vence"} em {formatarData(doc.validoAte)}</Selo>
                </li>
              ))}
            </ul>
          )}
          {vencidos.length > 0 && (
            <p className="aviso erro pequeno" style={{ marginTop: 16 }}><AlertTriangle size={18} aria-hidden /> {vencidos.length} documento(s) já vencido(s). Peça a renovação ao cliente.</p>
          )}
        </section>

        <section className="cartao">
          <header><h2><ListChecks size={20} aria-hidden style={{ verticalAlign: "-3px" }} /> Clientes em entrada</h2></header>
          {d.emEntrada.length === 0 ? (
            <p className="suave">Nenhum cliente em entrada.</p>
          ) : (
            <ul className="pilha" style={{ listStyle: "none", padding: 0, margin: 0, gap: 12 }}>
              {d.emEntrada.map((c) => (
                <li key={c.id} className="linha" style={{ justifyContent: "space-between" }}>
                  <Link href={`/clientes/${c.id}?aba=entrada`}>{c.pessoa.nome}</Link>
                  <Selo tom={c._count.checklistEntrada ? "atencao" : "positivo"}>
                    {c._count.checklistEntrada ? `${c._count.checklistEntrada} pendente(s)` : "Pronto para ativar"}
                  </Selo>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {d.carteiras.length > 0 && (
        <section className="cartao">
          <header>
            <h2><Briefcase size={20} aria-hidden style={{ verticalAlign: "-3px" }} /> Carteiras</h2>
            <div className="linha">
              {pode(usuario.perfil, "carteiras.gerenciar") && <Link className="botao secundario pequeno" href="/carteiras"><Briefcase size={16} aria-hidden /> Carteiras</Link>}
              {pode(usuario.perfil, "usuarios.gerenciar") && <Link className="botao secundario pequeno" href="/equipe"><UserCog size={16} aria-hidden /> Equipe</Link>}
            </div>
          </header>
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Carteira</th><th>Responsável</th><th className="num">Clientes</th></tr></thead>
              <tbody>
                {d.carteiras.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/clientes?carteira=${c.id}`}>{c.nome}</Link></td>
                    <td>{c.responsavel.nome}</td>
                    <td className="num">{c._count.clientes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {total("ATIVO") + total("EM_ENTRADA") === 0 && (
        <div className="cartao vazio">
          <Users size={32} aria-hidden />
          <p>Ainda não há clientes {usuario.perfil.startsWith("ANALISTA") ? "na sua carteira" : "cadastrados"}.</p>
          {pode(usuario.perfil, "importacao.clientes") && <Link className="botao" href="/importacoes">Importar da planilha</Link>}
        </div>
      )}
    </div>
  );
}
