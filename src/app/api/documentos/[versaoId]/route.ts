import { NextResponse } from "next/server";
import { acessoParaAcao } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { obterClienteVisivel } from "@/lib/clientes";
import { lerArquivo } from "@/lib/armazenamento";

// Download de documento: confere sessão, escritório (RLS) e carteira; registra
// o acesso na linha do tempo do cliente (LGPD: registro de acessos).
export async function GET(_: Request, { params }: { params: Promise<{ versaoId: string }> }) {
  const { versaoId } = await params;
  const a = await acessoParaAcao();
  if (!a) return new NextResponse("Não autorizado", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(versaoId)) return new NextResponse("Não encontrado", { status: 404 });
  const autor = { id: a.usuario.id, escritorioId: a.usuario.escritorioId, perfil: a.usuario.perfil };

  const versao = await comEscritorio(a.ctx, async (tx) => {
    const v = await tx.versaoDocumento.findUnique({ where: { id: versaoId }, include: { documento: true } });
    if (!v || !(await obterClienteVisivel(tx, autor, v.documento.clienteId))) return null;
    await tx.eventoCliente.create({
      data: {
        escritorioId: autor.escritorioId, clienteId: v.documento.clienteId, tipo: "documento.baixado",
        resumo: `Documento baixado: ${v.documento.titulo} (v${v.versao})`, usuarioId: autor.id,
      },
    });
    return v;
  });
  if (!versao) return new NextResponse("Não encontrado", { status: 404 });

  const conteudo = await lerArquivo(versao.chaveArquivo);
  const nome = encodeURIComponent(versao.nomeOriginal);
  return new NextResponse(new Uint8Array(conteudo), {
    headers: {
      "Content-Type": versao.tipoMime,
      "Content-Disposition": `attachment; filename*=UTF-8''${nome}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
