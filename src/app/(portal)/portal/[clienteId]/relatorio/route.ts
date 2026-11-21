import { acessoPortalParaAcao } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { formatarDocumento, formatarInstante, isoData, mascararDocumento } from "@/lib/br";
import { documentoEmClaro, obterClienteVisivel, registrarEvento } from "@/lib/clientes";
import { lerCompetencia } from "@/lib/contabil/lancamentos";
import { fimDoMes } from "@/lib/contabil/periodos";
import { montarRelatorio } from "@/lib/contabil/montar";
import { paraPdf } from "@/lib/contabil/exportar";

// Portal: só relatórios contábeis de meses FECHADOS (números conferidos pelo contador).
export async function GET(req: Request, { params }: { params: Promise<{ clienteId: string }> }) {
  const { clienteId } = await params;
  const a = await acessoPortalParaAcao();
  if (!a) return new Response("Não autorizado", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const tipo = sp.get("tipo");
  if (tipo !== "dre" && tipo !== "balanco" && tipo !== "balancete") return new Response("Relatório inválido", { status: 400 });
  let mes: Date;
  try {
    mes = lerCompetencia(sp.get("mes") ?? "");
  } catch {
    return new Response("Mês inválido", { status: 400 });
  }
  const autor = { id: a.usuario.id, escritorioId: a.usuario.escritorioId, perfil: a.usuario.perfil };
  const r = await comEscritorio(a.ctx, async (tx) => {
    const c = await obterClienteVisivel(tx, autor, clienteId);
    if (!c) return null;
    const p = await tx.periodoContabil.findUnique({ where: { clienteId_competencia: { clienteId, competencia: mes } } });
    if (p?.situacao !== "FECHADO") return null;
    const esc = await tx.escritorio.findUniqueOrThrow({ where: { id: autor.escritorioId }, select: { nome: true } });
    const rel = await montarRelatorio(tx, clienteId, { tipo, de: isoData(mes), ate: isoData(fimDoMes(mes)), nivel: 3 });
    await registrarEvento(tx, autor, clienteId, "portal.relatorio", `Cliente baixou ${rel.tabela.titulo} de ${sp.get("mes")}`);
    const pe = c.pessoa;
    return paraPdf(rel.tabela, { escritorio: esc.nome, cliente: pe.nome, documento: pe.tipo === "PJ" ? `CNPJ ${formatarDocumento("PJ", documentoEmClaro(pe))}` : `CPF ${mascararDocumento("PF", pe.documentoFinal)}`, periodo: rel.periodo, emitidoEm: formatarInstante(new Date()), emitidoPor: a.usuario.nome });
  });
  if (!r) return new Response("Não encontrado ou mês ainda não fechado", { status: 404 });
  return new Response(new Uint8Array(r), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${tipo}-${sp.get("mes")}.pdf"`, "Cache-Control": "private, no-store" } });
}
