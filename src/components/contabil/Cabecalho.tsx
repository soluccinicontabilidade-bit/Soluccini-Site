import Link from "next/link";

const ABAS = [
  ["", "Lançamentos"],
  ["/relatorios", "Relatórios"],
  ["/fechamento", "Fechamento"],
  ["/plano", "Plano de contas"],
  ["/importar", "Importar"],
] as const;

export function CabecalhoContabil({ clienteId, nome, codigo, atual, acoes }: { clienteId: string; nome: string; codigo: number; atual: (typeof ABAS)[number][0]; acoes?: React.ReactNode }) {
  return (
    <>
      <div className="cabecalho">
        <div className="sobre">
          <span className="trilha"><Link href="/contabilidade">Contabilidade</Link> / <Link href={`/clientes/${clienteId}`}>nº {codigo}</Link></span>
          <h1>{nome}</h1>
        </div>
        {acoes}
      </div>
      <nav className="abas" aria-label="Seções da contabilidade">
        {ABAS.map(([sufixo, rotulo]) => (
          <Link key={sufixo} href={`/contabilidade/${clienteId}${sufixo}`} aria-current={atual === sufixo ? "page" : undefined}>{rotulo}</Link>
        ))}
      </nav>
    </>
  );
}
