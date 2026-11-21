import { acessoParaAcao } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { ErroDeNegocio } from "@/lib/erros";
import { dadosDoTitular } from "@/lib/portal";

export async function GET(_: Request, { params }: { params: Promise<{ pessoaId: string }> }) {
  const { pessoaId } = await params;
  const a = await acessoParaAcao("lgpd.exportar");
  if (!a) return new Response("Não autorizado", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(pessoaId)) return new Response("Não encontrado", { status: 404 });
  try {
    const dados = await comEscritorio(a.ctx, (tx) => dadosDoTitular(tx, { id: a.usuario.id, escritorioId: a.usuario.escritorioId, perfil: a.usuario.perfil }, pessoaId));
    return new Response(JSON.stringify(dados, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="dados-titular-${pessoaId.slice(0, 8)}.json"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ErroDeNegocio) return new Response(e.message, { status: 400 });
    throw e;
  }
}
