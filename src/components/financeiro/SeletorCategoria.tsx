import type { CategoriaFinanceira } from "@prisma/client";

/** <select> de categorias agrupadas (grupo → categorias), filtrando pelo tipo. */
export function OpcoesCategorias({ categorias, tipo }: { categorias: CategoriaFinanceira[]; tipo?: "RECEITA" | "DESPESA" }) {
  const grupos = categorias.filter((c) => !c.paiId && (!tipo || c.tipo === tipo));
  return (
    <>
      <option value="">Escolha</option>
      {grupos.map((g) => (
        <optgroup key={g.id} label={`${g.nome} (${g.tipo === "RECEITA" ? "receita" : "despesa"})`}>
          {categorias.filter((c) => c.paiId === g.id && c.ativa).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </optgroup>
      ))}
    </>
  );
}
