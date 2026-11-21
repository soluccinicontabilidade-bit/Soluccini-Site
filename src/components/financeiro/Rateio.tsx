"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useEstadoForm } from "@/components/Formulario";

interface Opcao { id: string; nome: string; grupo: string; tipo: string }
interface Linha { categoriaId: string; centroCustoId: string; valor: string }

/** Divide o título em várias categorias (opcional). Os valores precisam somar o total. */
export function Rateio({ categorias, centros }: { categorias: Opcao[]; centros: { id: string; nome: string }[] }) {
  const estado = useEstadoForm();
  const anterior = estado.dados?.rateios ? (JSON.parse(String(estado.dados.rateios)) as Linha[]) : null;
  const [ativo, setAtivo] = useState(estado.valores?.usarRateio === "sim");
  const [linhas, setLinhas] = useState<Linha[]>(anterior?.length ? anterior : [{ categoriaId: "", centroCustoId: "", valor: "" }, { categoriaId: "", centroCustoId: "", valor: "" }]);
  const muda = (i: number, k: keyof Linha, v: string) => setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const grupos = [...new Set(categorias.map((c) => c.grupo))];
  return (
    <fieldset className="ocupa-tudo">
      <legend>Dividir em várias categorias</legend>
      <label className="opcao"><input type="checkbox" name="usarRateio" value="sim" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Este título tem mais de uma categoria</label>
      <input type="hidden" name="rateios" value={JSON.stringify(linhas)} />
      {ativo && (
        <div className="pilha" style={{ gap: 8, marginTop: 12 }}>
          {linhas.map((l, i) => (
            <div key={i} className="linha" style={{ alignItems: "flex-end" }}>
              <div className="campo" style={{ flex: "2 1 200px" }}>
                <label htmlFor={`r-cat-${i}`}>Categoria</label>
                <select id={`r-cat-${i}`} value={l.categoriaId} onChange={(e) => muda(i, "categoriaId", e.target.value)}>
                  <option value="">Escolha</option>
                  {grupos.map((g) => <optgroup key={g} label={g}>{categorias.filter((c) => c.grupo === g).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</optgroup>)}
                </select>
              </div>
              {centros.length > 0 && (
                <div className="campo" style={{ flex: "1 1 140px" }}>
                  <label htmlFor={`r-cc-${i}`}>Centro de custo</label>
                  <select id={`r-cc-${i}`} value={l.centroCustoId} onChange={(e) => muda(i, "centroCustoId", e.target.value)}>
                    <option value="">Nenhum</option>
                    {centros.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </div>
              )}
              <div className="campo" style={{ flex: "1 1 110px" }}>
                <label htmlFor={`r-v-${i}`}>Valor (R$)</label>
                <input id={`r-v-${i}`} className="num" inputMode="decimal" value={l.valor} onChange={(e) => muda(i, "valor", e.target.value)} />
              </div>
              <button type="button" className="botao texto" disabled={linhas.length <= 2} onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remover linha ${i + 1}`}><Trash2 size={18} aria-hidden /></button>
            </div>
          ))}
          <div><button type="button" className="botao secundario pequeno" onClick={() => setLinhas((ls) => [...ls, { categoriaId: "", centroCustoId: "", valor: "" }])}><Plus size={16} aria-hidden /> Categoria</button></div>
        </div>
      )}
    </fieldset>
  );
}
