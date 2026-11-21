import { acessoParaAcao } from "@/lib/auth/sessao";
import { modeloCsv } from "@/lib/importacao";

export async function GET() {
  if (!(await acessoParaAcao("importacao.clientes"))) return new Response("Não autorizado", { status: 401 });
  return new Response(modeloCsv(), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="modelo-clientes.csv"' },
  });
}
