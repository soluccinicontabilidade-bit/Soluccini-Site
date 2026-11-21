import { acessoParaAcao } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { formatarDocumento, formatarInstante, hojeSaoPaulo, isoData, mascararDocumento } from "@/lib/br";
import { documentoEmClaro, obterClienteVisivel, registrarEvento } from "@/lib/clientes";
import { ErroDeNegocio } from "@/lib/erros";
import { lerPedido, montarRelatorio, TIPOS_RELATORIO } from "@/lib/contabil/montar";
import { paraCsv, paraPdf, paraXlsx } from "@/lib/contabil/exportar";

const TIPOS = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
} as const;

export async function GET(req: Request, { params }: { params: Promise<{ clienteId: string }> }) {
  const { clienteId } = await params;
  const a = await acessoParaAcao("contabil.ver");
  if (!a) return new Response("Não autorizado", { status: 401 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const formato = (sp.formato in TIPOS ? sp.formato : "pdf") as keyof typeof TIPOS;
  const hoje = isoData(hojeSaoPaulo());
  const pedido = lerPedido(sp, hoje.slice(0, 8) + "01", hoje);
  const autor = { id: a.usuario.id, escritorioId: a.usuario.escritorioId, perfil: a.usuario.perfil };
  try {
    const r = await comEscritorio(a.ctx, async (tx) => {
      const cliente = await obterClienteVisivel(tx, autor, clienteId);
      if (!cliente) return null;
      const escritorio = await tx.escritorio.findUniqueOrThrow({ where: { id: a.usuario.escritorioId }, select: { nome: true } });
      const rel = await montarRelatorio(tx, clienteId, pedido);
      await registrarEvento(tx, autor, clienteId, "relatorio.exportado", `${TIPOS_RELATORIO[pedido.tipo]} exportado em ${formato.toUpperCase()} (${rel.periodo})`);
      const p = cliente.pessoa;
      // CNPJ da empresa sai completo no relatório; CPF de pessoa física sai mascarado.
      const documento = p.tipo === "PJ" ? `CNPJ ${formatarDocumento("PJ", documentoEmClaro(p))}` : `CPF ${mascararDocumento("PF", p.documentoFinal)}`;
      return { rel, cab: { escritorio: escritorio.nome, cliente: p.nome, documento, periodo: rel.periodo, emitidoEm: formatarInstante(new Date()), emitidoPor: a.usuario.nome } };
    });
    if (!r) return new Response("Não encontrado", { status: 404 });
    const corpo = formato === "csv" ? Buffer.from(paraCsv(r.rel.tabela, r.cab)) : formato === "xlsx" ? await paraXlsx(r.rel.tabela, r.cab) : await paraPdf(r.rel.tabela, r.cab);
    const nome = `${pedido.tipo}-${pedido.de}-a-${pedido.ate}.${formato}`;
    return new Response(new Uint8Array(corpo), {
      headers: { "Content-Type": TIPOS[formato], "Content-Disposition": `attachment; filename="${nome}"`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof ErroDeNegocio) return new Response(e.message, { status: 400 });
    throw e;
  }
}
