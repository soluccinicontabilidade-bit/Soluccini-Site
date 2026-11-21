import type { Metadata } from "next";
import Link from "next/link";
import { exigirAcesso } from "@/lib/auth/sessao";
import { filtroClientes } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { hojeSaoPaulo } from "@/lib/br";
import { Selo } from "@/components/Selo";

export const metadata: Metadata = { title: "Financeiro" };

export default async function Financeiro() {
  const { usuario, ctx } = await exigirAcesso("financeiro.ver");
  const hoje = hojeSaoPaulo();
  const dados = await comEscritorio(ctx, async (tx) => {
    const clientes = await tx.cliente.findMany({
      where: { AND: [filtroClientes(usuario), { situacao: { not: "ENCERRADO" } }, { contratos: { some: { fim: null, servicos: { has: "BPO_FINANCEIRO" } } } }] },
      include: { pessoa: { select: { nome: true } }, _count: { select: { contasBancarias: true } } },
      orderBy: { pessoa: { nome: "asc" } },
    });
    return Promise.all(clientes.map(async (c) => ({
      c,
      vencidas: await tx.parcela.count({ where: { clienteId: c.id, situacao: { in: ["ABERTA", "APROVADA", "REPROVADA"] }, vencimento: { lt: hoje }, titulo: { canceladoEm: null } } }),
      aguardando: await tx.parcela.count({ where: { clienteId: c.id, situacao: "AGUARDANDO_APROVACAO" } }),
      pendentes: await tx.transacaoBancaria.count({ where: { clienteId: c.id, situacao: { in: ["PENDENTE", "SUGERIDA"] } } }),
    })));
  });
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho"><div className="sobre"><h1>Financeiro</h1><p className="suave">Clientes com BPO financeiro no contrato vigente.</p></div></div>
      <section className="cartao">
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Cliente</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {dados.map(({ c, vencidas, aguardando, pendentes }) => (
                <tr key={c.id}>
                  <td><Link href={`/financeiro/${c.id}`}>{c.pessoa.nome}</Link><div className="suave pequeno">nº {c.codigo}</div></td>
                  <td>
                    <div className="linha" style={{ gap: 4 }}>
                      {c._count.contasBancarias === 0 && <Selo tom="atencao">Sem conta bancária</Selo>}
                      {vencidas > 0 && <Selo tom="erro">{vencidas} vencida(s)</Selo>}
                      {aguardando > 0 && <Selo tom="atencao">{aguardando} aguardando aprovação</Selo>}
                      {pendentes > 0 && <Selo tom="atencao">{pendentes} transação(ões) a conciliar</Selo>}
                      {c._count.contasBancarias > 0 && !vencidas && !aguardando && !pendentes && <Selo tom="positivo">Em dia</Selo>}
                    </div>
                  </td>
                  <td><Link className="botao secundario pequeno" href={`/financeiro/${c.id}`}>Abrir</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {dados.length === 0 && <p className="suave">Nenhum cliente com BPO financeiro no contrato. O serviço é marcado no contrato do cliente.</p>}
      </section>
    </div>
  );
}
