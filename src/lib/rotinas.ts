// Rotinas automáticas, chamadas por um agendador externo (cron do servidor ou
// da hospedagem) em POST /api/rotinas com o segredo ROTINAS_SEGREDO:
// 1) relatórios agendados por cliente (PDF por e-mail, ou guardado como documento);
// 2) avisos para a equipe (tarefas, documentos e prazos do IRPF);
// 3) limpeza de sessões, links e tentativas antigas.
import { comEscritorio, prisma, type Tx } from "@/lib/db";
import { formatarData, formatarDocumento, formatarInstante, hojeSaoPaulo, isoData, mascararDocumento } from "@/lib/br";
import { documentoEmClaro } from "@/lib/clientes";
import { enviarDocumento } from "@/lib/documentos";
import { emailConfigurado, enviarEmail } from "@/lib/email";
import { notificar } from "@/lib/tarefas";
import { paraPdf } from "@/lib/contabil/exportar";
import { montarRelatorio, TIPOS_RELATORIO, type TipoRelatorio } from "@/lib/contabil/montar";
import { montarRelatorioFin } from "@/lib/financeiro/montar";
import { TIPOS_RELATORIO_FIN, type TipoRelatorioFin } from "@/lib/financeiro/relatorios";

export async function idsDosEscritorios(): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.rotina_sistema', 'sim', true)`;
    return (await tx.escritorio.findMany({ select: { id: true } })).map((e) => e.id);
  });
}

const fimDoMes = (c: Date) => new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 0));

/** Gera e envia os relatórios agendados para hoje (do mês anterior). */
export async function rodarAgendamentos(escritorioId: string, hoje = hojeSaoPaulo()) {
  const ctx = { escritorioId, origem: "rotina:relatorios" };
  const competencia = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1));
  const devidos = await comEscritorio(ctx, (tx) =>
    tx.agendamentoRelatorio.findMany({
      where: { ativo: true, diaDoMes: { lte: hoje.getUTCDate() }, OR: [{ ultimaCompetencia: null }, { ultimaCompetencia: { lt: competencia } }] },
      include: { cliente: { include: { pessoa: true } } },
    }),
  );
  const resultados: string[] = [];
  for (const ag of devidos) {
    try {
      const r = await comEscritorio(ctx, async (tx) => {
        const esc = await tx.escritorio.findUniqueOrThrow({ where: { id: escritorioId }, select: { nome: true } });
        const de = isoData(competencia), ate = isoData(fimDoMes(competencia));
        const rel = ag.modulo === "CONTABIL"
          ? await montarRelatorio(tx, ag.clienteId, { tipo: ag.tipo as TipoRelatorio, de, ate, nivel: 3 })
          : await montarRelatorioFin(tx, ag.clienteId, { tipo: ag.tipo as TipoRelatorioFin, de, ate });
        const p = ag.cliente.pessoa;
        const pdf = await paraPdf(rel.tabela, {
          escritorio: esc.nome, cliente: p.nome, documento: p.tipo === "PJ" ? `CNPJ ${formatarDocumento("PJ", documentoEmClaro(p))}` : `CPF ${mascararDocumento("PF", p.documentoFinal)}`,
          periodo: rel.periodo, emitidoEm: formatarInstante(new Date()), emitidoPor: "envio automático",
        });
        const nomeRel = ag.modulo === "CONTABIL" ? TIPOS_RELATORIO[ag.tipo as TipoRelatorio] : TIPOS_RELATORIO_FIN[ag.tipo as TipoRelatorioFin];
        const nomeArq = `${nomeRel} ${de.slice(0, 7)}.pdf`.replace(/\//g, "-");
        // Sempre guarda uma cópia como documento do cliente (aparece no portal).
        const cat = (await tx.categoriaDocumento.findFirst({ where: { nome: "Relatórios enviados" } })) ?? (await tx.categoriaDocumento.create({ data: { escritorioId, nome: "Relatórios enviados" } }));
        const sistema = { id: ag.criadoPorId, escritorioId, perfil: "ADMINISTRADOR" as const };
        const doc = await enviarDocumento(tx, sistema, ag.clienteId, { categoriaId: cat.id, titulo: nomeArq, competencia: de.slice(0, 7), arquivo: { nome: nomeArq, tipo: "application/pdf", conteudo: pdf } });
        return { pdf, nomeArq, nomeRel, doc, cliente: p.nome };
      }, { timeout: 120000 });
      let situacao: "ENVIADO" | "GUARDADO_SEM_EMAIL" = "GUARDADO_SEM_EMAIL";
      if (emailConfigurado() && ag.destinatarios.length) {
        await enviarEmail({
          para: ag.destinatarios, assunto: `${r.nomeRel} de ${formatarData(competencia).slice(3)} · ${r.cliente}`,
          texto: `Olá. Seu relatório está disponível em anexo (${r.nomeRel}, ${formatarData(competencia).slice(3)}). Ele também fica no portal do cliente.\n\nQualquer dúvida, fale com o escritório.`,
          anexos: [{ nome: r.nomeArq, conteudo: r.pdf, tipo: "application/pdf" }],
        });
        situacao = "ENVIADO";
      }
      await comEscritorio(ctx, async (tx) => {
        await tx.envioRelatorio.create({ data: { escritorioId, agendamentoId: ag.id, competencia, situacao, documentoId: r.doc.id } });
        await tx.agendamentoRelatorio.update({ where: { id: ag.id }, data: { ultimaCompetencia: competencia } });
      });
      resultados.push(`${ag.cliente.pessoa.nome}: ${situacao}`);
    } catch (e) {
      const erro = e instanceof Error ? e.message.slice(0, 500) : String(e);
      await comEscritorio(ctx, (tx) => tx.envioRelatorio.create({ data: { escritorioId, agendamentoId: ag.id, competencia, situacao: "FALHOU", erro } }));
      resultados.push(`${ag.cliente.pessoa.nome}: FALHOU (${erro})`);
    }
  }
  return resultados;
}

/** Avisos do dia para a equipe (uma vez por assunto e por dia). */
export async function gerarAvisos(escritorioId: string, hoje = hojeSaoPaulo()) {
  const dia = isoData(hoje);
  const em3 = new Date(hoje.getTime() + 3 * 86400_000);
  return comEscritorio({ escritorioId, origem: "rotina:avisos" }, async (tx: Tx) => {
    let n = 0;
    const tarefas = await tx.tarefa.findMany({ where: { concluidaEm: null, prazo: { lte: em3 }, responsavelId: { not: null } } });
    for (const t of tarefas) {
      await notificar(tx, escritorioId, t.responsavelId!, `${t.prazo < hoje ? "Atrasada" : "Vence em breve"}: ${t.titulo} (${formatarData(t.prazo)})`, `tarefa:${t.id}:${dia}`, "/tarefas");
      n++;
    }
    const admins = await tx.usuario.findMany({ where: { ativo: true, perfil: { in: ["ADMINISTRADOR", "CONTADOR"] } } });
    const docs = await tx.documento.count({ where: { excluidoEm: null, validoAte: { lte: em3, gte: hoje } } });
    if (docs) for (const u of admins) { await notificar(tx, escritorioId, u.id, `${docs} documento(s) de clientes vencem nos próximos 3 dias`, `docs:${dia}`, "/"); n++; }
    const decl = await tx.declaracaoIRPF.findMany({ where: { prazo: { lte: em3 }, situacao: { in: ["AGUARDANDO_DOCUMENTOS", "EM_ANALISE", "EM_DIGITACAO", "EM_REVISAO"] }, responsavelId: { not: null } }, include: { pessoa: { select: { nome: true } } } });
    for (const d of decl) { await notificar(tx, escritorioId, d.responsavelId!, `IRPF de ${d.pessoa.nome}: prazo ${formatarData(d.prazo)}`, `irpf:${d.id}:${dia}`, `/irpf/${d.id}`); n++; }
    const aprov = await tx.parcela.findMany({ where: { situacao: "APROVADA", baixadoEm: null, aprovadoEm: { gte: new Date(hoje.getTime() - 86400_000) } }, include: { titulo: { include: { cliente: { include: { carteiras: { include: { carteira: true } } } } } } } });
    for (const p of aprov) for (const c of p.titulo.cliente.carteiras) { await notificar(tx, escritorioId, c.carteira.responsavelId, `Pagamento aprovado pelo cliente: ${p.titulo.descricao}`, `aprov:${p.id}`, `/financeiro/${p.clienteId}?ver=abertas`); n++; }
    return n;
  });
}

export async function limpeza() {
  const antes = new Date(Date.now() - 30 * 86400_000);
  const t = await prisma.tentativaAcesso.deleteMany({ where: { ocorridaEm: { lt: new Date(Date.now() - 86400_000) } } });
  return { tentativas: t.count, antes };
}

export async function rodarTudo() {
  const ids = await idsDosEscritorios();
  const relatorio: Record<string, unknown> = {};
  for (const id of ids) relatorio[id] = { relatorios: await rodarAgendamentos(id), avisos: await gerarAvisos(id) };
  relatorio.limpeza = await limpeza();
  return relatorio;
}
