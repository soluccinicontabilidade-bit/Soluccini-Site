import { iguaisSemVazamento } from "@/lib/cripto";
import { rodarTudo } from "@/lib/rotinas";

// Chamar 1 vez por dia: curl -X POST -H "Authorization: Bearer $ROTINAS_SEGREDO" https://.../api/rotinas
export async function POST(req: Request) {
  const segredo = process.env.ROTINAS_SEGREDO;
  const enviado = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!segredo || segredo.length < 32 || !iguaisSemVazamento(enviado, segredo)) return new Response("Não autorizado", { status: 401 });
  const r = await rodarTudo();
  return Response.json(JSON.parse(JSON.stringify(r, (_, v) => (typeof v === "bigint" ? v.toString() : v))));
}
