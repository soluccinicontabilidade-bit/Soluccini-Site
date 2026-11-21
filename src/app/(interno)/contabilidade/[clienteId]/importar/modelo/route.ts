import { acessoParaAcao } from "@/lib/auth/sessao";
import { modeloPlanoCsv, modeloSaldosCsv } from "@/lib/contabil/lancamentos";

export async function GET(req: Request) {
  if (!(await acessoParaAcao("contabil.importar"))) return new Response("Não autorizado", { status: 401 });
  const plano = new URL(req.url).searchParams.get("tipo") === "plano";
  return new Response(plano ? modeloPlanoCsv() : modeloSaldosCsv(), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="modelo-${plano ? "plano-de-contas" : "saldos-iniciais"}.csv"` },
  });
}
