import Link from "next/link";

const ABAS = [
  ["", "Pagar e receber"],
  ["/conciliacao", "Conciliação"],
  ["/contas", "Contas bancárias"],
  ["/relatorios", "Relatórios"],
  ["/rotina", "Rotina do mês"],
  ["/cadastros", "Cadastros"],
] as const;

export function CabecalhoFinanceiro({ clienteId, nome, codigo, atual, acoes }: { clienteId: string; nome: string; codigo: number; atual: (typeof ABAS)[number][0]; acoes?: React.ReactNode }) {
  return (
    <>
      <div className="cabecalho">
        <div className="sobre">
          <span className="trilha"><Link href="/financeiro">Financeiro</Link> / <Link href={`/clientes/${clienteId}`}>nº {codigo}</Link></span>
          <h1>{nome}</h1>
        </div>
        {acoes}
      </div>
      <nav className="abas" aria-label="Seções do financeiro">
        {ABAS.map(([s, r]) => <Link key={s} href={`/financeiro/${clienteId}${s}`} aria-current={atual === s ? "page" : undefined}>{r}</Link>)}
      </nav>
    </>
  );
}
