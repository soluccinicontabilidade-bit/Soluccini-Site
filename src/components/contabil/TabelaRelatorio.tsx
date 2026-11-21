import { AlertTriangle } from "lucide-react";
import { textoCelula, type Tabela } from "@/lib/contabil/relatorios";

export function TabelaRelatorio({ tabela }: { tabela: Tabela }) {
  const ehSaldo = tabela.colunas.map((c) => /saldo/i.test(c.rotulo));
  return (
    <div className="pilha">
      {tabela.alerta && <div className="aviso erro" role="alert"><AlertTriangle size={20} aria-hidden /> {tabela.alerta}</div>}
      <div className="tabela-rolagem">
        <table className="relatorio">
          <thead>
            <tr>{tabela.colunas.map((c) => <th key={c.rotulo} className={c.valor ? "num" : undefined}>{c.rotulo}</th>)}</tr>
          </thead>
          <tbody>
            {tabela.linhas.length === 0 && (
              <tr><td colSpan={tabela.colunas.length} className="suave">Sem movimento no período.</td></tr>
            )}
            {tabela.linhas.map((l, i) => (
              <tr key={i} className={l.destaque ? `linha-${l.destaque}` : undefined}>
                {l.celulas.map((c, j) => (
                  <td key={j} className={tabela.colunas[j]?.valor ? "num" : undefined} style={j <= 1 && l.nivel ? { paddingLeft: 12 + l.nivel * 14 } : undefined}>
                    {textoCelula(c, ehSaldo[j])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tabela.notas?.map((n) => <p key={n} className="suave pequeno">{n}</p>)}
    </div>
  );
}
