import { acessoParaAcao } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { formatarDocumento, formatarInstante, hojeSaoPaulo, isoData, mascararDocumento } from "@/lib/br";
import { documentoEmClaro, obterClienteVisivel, registrarEvento } from "@/lib/clientes";
import { ErroDeNegocio } from "@/lib/erros";
import { lerPedidoFin, montarRelatorioFin } from "@/lib/financeiro/montar";
import { TIPOS_RELATORIO_FIN } from "@/lib/financeiro/relatorios";
import { paraCsv, paraPdf, paraXlsx } from "@/lib/contabil/exportar";

const MIME = { pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv; charset=utf-8" } as const;

export async function GET(req: Request, { params }: { params: Promise<{ clienteId: string }> }) {
  const { clienteId } = await params;
  const a = await acessoParaAcao("financeiro.ver");
  if (!a) return new Response("Não autorizado", { status: 401 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const formato = (sp.formato in MIME ? sp.formato : "pdf") as keyof typeof MIME;
  const hoje = isoData(hojeSaoPaulo());
  const pedido = lerPedidoFin(sp, `${hoje.slice(0, 8)}01`, hoje);
  const autor = { id: a.usuario.id, escritorioId: a.usuario.escritorioId, perfil: a.usuario.perfil };
  try {
    const r = await comEscritorio(a.ctx, async (tx) => {
      const c = await obterClienteVisivel(tx, autor, clienteId);
      if (!c) return null;
      const esc = await tx.escritorio.findUniqueOrThrow({ where: { id: autor.escritorioId }, select: { nome: true } });
      const rel = await montarRelatorioFin(tx, clienteId, pedido);
      await registrarEvento(tx, autor, clienteId, "relatorio.exportado", `${TIPOS_RELATORIO_FIN[pedido.tipo]} exportado em ${formato.toUpperCase()}`);
      const p = c.pessoa;
      return { rel, cab: { escritorio: esc.nome, cliente: p.nome, documento: p.tipo === "PJ" ? `CNPJ ${formatarDocumento("PJ", documentoEmClaro(p))}` : `CPF ${mascararDocumento("PF", p.documentoFinal)}`, periodo: rel.periodo, emitidoEm: formatarInstante(new Date()), emitidoPor: a.usuario.nome } };
    });
    if (!r) return new Response("Não encontrado", { status: 404 });
    const corpo = formato === "csv" ? Buffer.from(paraCsv(r.rel.tabela, r.cab)) : formato === "xlsx" ? await paraXlsx(r.rel.tabela, r.cab) : await paraPdf(r.rel.tabela, r.cab);
    return new Response(new Uint8Array(corpo), { headers: { "Content-Type": MIME[formato], "Content-Disposition": `attachment; filename="financeiro-${pedido.tipo}-${pedido.de}.${formato}"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof ErroDeNegocio) return new Response(e.message, { status: 400 });
    throw e;
  }
}
