import { acessoPortalParaAcao } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { obterClienteVisivel } from "@/lib/clientes";
import { lerArquivo } from "@/lib/armazenamento";

export async function GET(_: Request, { params }: { params: Promise<{ versaoId: string }> }) {
  const { versaoId } = await params;
  const a = await acessoPortalParaAcao();
  if (!a) return new Response("Não autorizado", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(versaoId)) return new Response("Não encontrado", { status: 404 });
  const autor = { id: a.usuario.id, escritorioId: a.usuario.escritorioId, perfil: a.usuario.perfil };
  const v = await comEscritorio(a.ctx, async (tx) => {
    const ver = await tx.versaoDocumento.findUnique({ where: { id: versaoId }, include: { documento: true } });
    if (!ver || ver.documento.excluidoEm || !(await obterClienteVisivel(tx, autor, ver.documento.clienteId))) return null;
    await tx.eventoCliente.create({ data: { escritorioId: autor.escritorioId, clienteId: ver.documento.clienteId, tipo: "portal.download", resumo: `Cliente baixou: ${ver.documento.titulo}`, usuarioId: autor.id } });
    return ver;
  });
  if (!v) return new Response("Não encontrado", { status: 404 });
  const conteudo = await lerArquivo(v.chaveArquivo);
  return new Response(new Uint8Array(conteudo), { headers: { "Content-Type": v.tipoMime, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(v.nomeOriginal)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
