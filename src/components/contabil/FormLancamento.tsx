"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Campo, Formulario, useEstadoForm } from "@/components/Formulario";
import type { EstadoForm } from "@/lib/form";

export interface ContaOpcao {
  codigo: string;
  nome: string;
}

interface LinhaPartida {
  conta: string;
  tipo: "DEBITO" | "CREDITO";
  valor: string;
  historico: string;
}

const vazia = (tipo: "DEBITO" | "CREDITO"): LinhaPartida => ({ conta: "", tipo, valor: "", historico: "" });

// Mesmo formato do servidor (centavos inteiros), só para mostrar a diferença enquanto digita.
function centavos(v: string): bigint | null {
  const s = v.trim().replace(/^R\$\s*/, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) return null;
  const [i, f = ""] = s.replace(/\./g, "").split(",");
  return BigInt(i) * 100n + BigInt((f + "00").slice(0, 2));
}
const reais = (c: bigint) => {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? "-" : ""}R$ ${(a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${(a % 100n).toString().padStart(2, "0")}`;
};

function Linhas({ contas, inicial }: { contas: ContaOpcao[]; inicial: LinhaPartida[] }) {
  const estado = useEstadoForm();
  const reenviadas = estado.dados?.partidas ? (JSON.parse(String(estado.dados.partidas)) as LinhaPartida[]) : null;
  const [linhas, setLinhas] = useState<LinhaPartida[]>(reenviadas ?? inicial);
  const [chaveEstado, setChaveEstado] = useState(estado);
  if (chaveEstado !== estado) {
    // Depois de um erro, mantém o que a pessoa digitou.
    setChaveEstado(estado);
    if (reenviadas) setLinhas(reenviadas);
  }
  const nomes = useMemo(() => new Map(contas.map((c) => [c.codigo, c.nome])), [contas]);
  const soma = (t: "DEBITO" | "CREDITO") => linhas.filter((l) => l.tipo === t).reduce((s, l) => s + (centavos(l.valor) ?? 0n), 0n);
  const d = soma("DEBITO");
  const c = soma("CREDITO");
  const muda = (i: number, campo: keyof LinhaPartida, v: string) => setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: v } : l)));

  return (
    <fieldset>
      <legend>Partidas</legend>
      <datalist id="contas-analiticas">
        {contas.map((ct) => <option key={ct.codigo} value={`${ct.codigo} - ${ct.nome}`} />)}
      </datalist>
      <input type="hidden" name="partidas" value={JSON.stringify(linhas)} />
      <div className="pilha" style={{ gap: 12 }}>
        {linhas.map((l, i) => {
          const codigo = l.conta.split(" ")[0];
          const desconhecida = l.conta.trim() !== "" && !nomes.has(codigo);
          return (
            <div key={i} className="partida-linha">
              <div className="campo">
                <label htmlFor={`p-tipo-${i}`}>D/C</label>
                <select id={`p-tipo-${i}`} value={l.tipo} onChange={(e) => muda(i, "tipo", e.target.value)}>
                  <option value="DEBITO">Débito</option>
                  <option value="CREDITO">Crédito</option>
                </select>
              </div>
              <div className="campo">
                <label htmlFor={`p-conta-${i}`}>Conta</label>
                <input id={`p-conta-${i}`} list="contas-analiticas" value={l.conta} onChange={(e) => muda(i, "conta", e.target.value)}
                  placeholder="Digite o código ou o nome" aria-invalid={desconhecida || undefined} autoComplete="off" />
                {desconhecida && <span className="erro-campo">Conta não encontrada entre as analíticas.</span>}
                {!desconhecida && nomes.has(codigo) && !l.conta.includes(" - ") && <span className="ajuda">{nomes.get(codigo)}</span>}
              </div>
              <div className="campo">
                <label htmlFor={`p-valor-${i}`}>Valor (R$)</label>
                <input id={`p-valor-${i}`} inputMode="decimal" value={l.valor} onChange={(e) => muda(i, "valor", e.target.value)} placeholder="0,00"
                  aria-invalid={l.valor.trim() !== "" && centavos(l.valor) === null ? true : undefined} className="num" />
              </div>
              <div className="campo">
                <label htmlFor={`p-hist-${i}`}>Complemento</label>
                <input id={`p-hist-${i}`} value={l.historico} onChange={(e) => muda(i, "historico", e.target.value)} maxLength={200} />
              </div>
              <button type="button" className="botao texto" onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))} disabled={linhas.length <= 2} aria-label={`Remover partida ${i + 1}`}>
                <Trash2 size={18} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
      <div className="linha" style={{ marginTop: 12, justifyContent: "space-between" }}>
        <div className="linha">
          <button type="button" className="botao secundario pequeno" onClick={() => setLinhas((ls) => [...ls, vazia("DEBITO")])}><Plus size={16} aria-hidden /> Débito</button>
          <button type="button" className="botao secundario pequeno" onClick={() => setLinhas((ls) => [...ls, vazia("CREDITO")])}><Plus size={16} aria-hidden /> Crédito</button>
        </div>
        <div className="tabular pequeno" aria-live="polite">
          Débitos <strong>{reais(d)}</strong> · Créditos <strong>{reais(c)}</strong> ·{" "}
          {d === c && d > 0n ? <span className="selo positivo">Fechado</span> : <span className="selo atencao">Diferença {reais(d - c)}</span>}
        </div>
      </div>
    </fieldset>
  );
}

export function FormLancamento({
  acao, contas, inicial, textoBotao, permitirContinuar,
}: {
  acao: (e: EstadoForm, f: FormData) => Promise<EstadoForm>;
  contas: ContaOpcao[];
  inicial?: { data: string; historico: string; origem: string; justificativa: string; partidas: LinhaPartida[] };
  textoBotao: string;
  permitirContinuar?: boolean;
}) {
  const ini = inicial ?? { data: "", historico: "", origem: "MANUAL", justificativa: "", partidas: [vazia("DEBITO"), vazia("CREDITO")] };
  return (
    <Formulario acao={acao} className="cartao pilha">
      <div className="campos campos-3">
        <Campo nome="data" rotulo="Data" tipo="date" valor={ini.data} obrigatorio />
        <Campo nome="origem" rotulo="Tipo" valor={ini.origem} opcoes={[{ valor: "MANUAL", rotulo: "Manual" }, { valor: "AJUSTE", rotulo: "Ajuste" }, { valor: "PROVISAO", rotulo: "Provisão" }]} />
        <Campo nome="justificativa" rotulo="Justificativa" valor={ini.justificativa} ajuda="Obrigatória para ajuste e provisão." />
        <Campo nome="historico" rotulo="Histórico" valor={ini.historico} obrigatorio className="ocupa-tudo" maxLength={500} placeholder="Ex.: Pagamento do aluguel de março, boleto 123" />
      </div>
      <Linhas contas={contas} inicial={ini.partidas} />
      <div className="linha">
        <button className="botao" type="submit" name="continuar" value="nao">{textoBotao}</button>
        {permitirContinuar && <button className="botao secundario" type="submit" name="continuar" value="sim">Salvar e lançar outro</button>}
      </div>
    </Formulario>
  );
}
