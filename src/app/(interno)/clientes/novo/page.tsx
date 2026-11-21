import type { Metadata } from "next";
import Link from "next/link";
import { exigirAcesso } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { CamposPessoa } from "@/components/CamposPessoa";
import { isoData, hojeSaoPaulo } from "@/lib/br";
import { acaoCriarCliente } from "../acoes";

export const metadata: Metadata = { title: "Cadastrar cliente" };

export default async function NovoCliente() {
  const { ctx } = await exigirAcesso("clientes.criar");
  const carteiras = await comEscritorio(ctx, (tx) => tx.carteira.findMany({ include: { responsavel: { select: { nome: true } } }, orderBy: { nome: "asc" } }));
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <span className="trilha"><Link href="/clientes">Clientes</Link> / Novo</span>
          <h1>Cadastrar cliente</h1>
          <p className="suave">Depois do cadastro, o cliente entra com o checklist de entrada aberto.</p>
        </div>
      </div>
      <Formulario acao={acaoCriarCliente} className="cartao pilha" >
        <CamposPessoa />
        <fieldset>
          <legend>Serviço</legend>
          <div className="campos campos-2">
            <Campo nome="inicioServico" rotulo="Início do atendimento" tipo="date" valor={isoData(hojeSaoPaulo())} obrigatorio />
            <Campo nome="regimeContabil" rotulo="Regime contábil" valor="COMPETENCIA"
              opcoes={[{ valor: "COMPETENCIA", rotulo: "Competência (padrão)" }, { valor: "CAIXA", rotulo: "Caixa" }]}
              ajuda="Competência registra quando a despesa ou receita acontece; caixa, quando o dinheiro entra ou sai." />
          </div>
          {carteiras.length > 0 && (
            <div className="pilha" style={{ gap: 8, marginTop: 16 }}>
              <span className="rotulo-campo">Carteiras</span>
              {carteiras.map((c) => (
                <label key={c.id} className="opcao"><input type="checkbox" name="carteiras" value={c.id} /> {c.nome} <span className="suave">({c.responsavel.nome})</span></label>
              ))}
            </div>
          )}
        </fieldset>
        <div className="linha">
          <BotaoEnviar>Cadastrar cliente</BotaoEnviar>
          <Link className="botao secundario" href="/clientes">Cancelar</Link>
        </div>
      </Formulario>
    </div>
  );
}
