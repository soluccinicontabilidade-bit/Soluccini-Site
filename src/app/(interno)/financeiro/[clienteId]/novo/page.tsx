import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { exigirAcesso } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { hojeSaoPaulo, isoData } from "@/lib/br";
import { clienteOu404 } from "@/lib/contabil/pagina";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Rateio } from "@/components/financeiro/Rateio";
import { acaoNovoTitulo } from "../../acoes";

export const metadata: Metadata = { title: "Novo título" };

export default async function NovoTitulo({ params, searchParams }: { params: Promise<{ clienteId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { clienteId } = await params;
  const sp = await searchParams;
  const acesso = await exigirAcesso("financeiro.operar");
  const d = await comEscritorio(acesso.ctx, async (tx) => ({
    cliente: await clienteOu404(tx, acesso, clienteId),
    categorias: await tx.categoriaFinanceira.findMany({ where: { clienteId, ativa: true }, orderBy: { ordem: "asc" } }),
    centros: await tx.centroDeCusto.findMany({ where: { clienteId, ativo: true }, orderBy: { nome: "asc" } }),
    contas: await tx.contaBancaria.findMany({ where: { clienteId, ativa: true }, orderBy: { nome: "asc" } }),
  }));
  const hoje = isoData(hojeSaoPaulo());
  const grupos = d.categorias.filter((c) => !c.paiId);
  const opcoes = [{ valor: "", rotulo: "Escolha" }, ...grupos.flatMap((g) => d.categorias.filter((c) => c.paiId === g.id).map((c) => ({ valor: c.id, rotulo: `${g.tipo === "RECEITA" ? "Receita" : "Despesa"} · ${g.nome} › ${c.nome}` })))];
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <span className="trilha"><Link href="/financeiro">Financeiro</Link> / <Link href={`/financeiro/${clienteId}`}>{d.cliente.pessoa.nome}</Link> / Novo título</span>
          <h1>Nova conta a pagar ou a receber</h1>
        </div>
      </div>
      {sp.criado && <div className="aviso positivo" role="status"><Check size={20} aria-hidden /> {sp.criado} título(s) criado(s). Pode lançar o próximo.</div>}
      {d.categorias.length === 0 ? (
        <div className="aviso atencao">Crie as categorias do cliente em <Link href={`/financeiro/${clienteId}/cadastros`}>Cadastros</Link>.</div>
      ) : (
        <Formulario acao={acaoNovoTitulo.bind(null, clienteId)} className="cartao campos campos-3">
          <Campo nome="tipo" rotulo="Tipo" valor={sp.tipo === "RECEBER" ? "RECEBER" : "PAGAR"} opcoes={[{ valor: "PAGAR", rotulo: "A pagar" }, { valor: "RECEBER", rotulo: "A receber" }]} />
          <Campo nome="descricao" rotulo="Descrição" obrigatorio className="ocupa-2" placeholder="Ex.: Aluguel da loja" />
          <Campo nome="favorecido" rotulo="Fornecedor ou cliente" />
          <Campo nome="documentoFavorecido" rotulo="CPF/CNPJ dele" inputMode="numeric" ajuda="Opcional. Liga o pagamento ao sócio, para o IRPF." />
          <Campo nome="documento" rotulo="Nº da nota ou boleto" />
          <Campo nome="valor" rotulo="Valor total (R$)" obrigatorio inputMode="decimal" />
          <Campo nome="competencia" rotulo="Competência" tipo="month" valor={hoje.slice(0, 7)} obrigatorio ajuda="Mês a que a despesa ou receita pertence." />
          <Campo nome="vencimento" rotulo="Vencimento (1ª parcela)" tipo="date" valor={hoje} obrigatorio />
          <Campo nome="categoriaId" rotulo="Categoria" opcoes={opcoes} ajuda="Não precisa se dividir em várias categorias abaixo." />
          {d.centros.length > 0 && <Campo nome="centroCustoId" rotulo="Centro de custo" opcoes={[{ valor: "", rotulo: "Nenhum" }, ...d.centros.map((c) => ({ valor: c.id, rotulo: c.nome }))]} />}
          <Campo nome="contaPrevistaId" rotulo="Conta prevista" opcoes={[{ valor: "", rotulo: "Qualquer" }, ...d.contas.map((c) => ({ valor: c.id, rotulo: c.nome }))]} />
          <Campo nome="parcelas" rotulo="Parcelas" tipo="number" valor="1" ajuda="Mensais, a partir do primeiro vencimento." />
          <Campo nome="repetirMeses" rotulo="Repetir nos próximos meses" tipo="number" valor="0" ajuda="Para despesas recorrentes, como aluguel. 0 = não repetir." />
          <Rateio categorias={grupos.flatMap((g) => d.categorias.filter((c) => c.paiId === g.id).map((c) => ({ id: c.id, nome: c.nome, grupo: `${g.nome} (${g.tipo === "RECEITA" ? "receita" : "despesa"})`, tipo: g.tipo })))} centros={d.centros} />
          <Campo nome="observacao" rotulo="Observação" tipo="textarea" className="ocupa-tudo" />
          <div className="linha ocupa-tudo">
            <BotaoEnviar nome="continuar" valor="nao">Salvar</BotaoEnviar>
            <BotaoEnviar nome="continuar" valor="sim" className="secundario">Salvar e lançar outro</BotaoEnviar>
          </div>
        </Formulario>
      )}
    </div>
  );
}
