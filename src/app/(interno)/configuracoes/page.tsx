import type { Metadata } from "next";
import { exigirAcesso } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { emailConfigurado } from "@/lib/email";
import { BotaoEnviar, Campo, Formulario } from "@/components/Formulario";
import { Selo } from "@/components/Selo";
import { acaoConfigPix } from "../acoes-gestao";

export const metadata: Metadata = { title: "Configurações" };

export default async function Configuracoes() {
  const { usuario, ctx } = await exigirAcesso("configuracoes");
  const cfg = await comEscritorio(ctx, (tx) => tx.configEscritorio.findUnique({ where: { escritorioId: usuario.escritorioId } }));
  const rotinas = !!process.env.ROTINAS_SEGREDO && process.env.ROTINAS_SEGREDO.length >= 32;
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho"><div className="sobre"><h1>Configurações do escritório</h1></div></div>
      <section className="cartao pilha">
        <h2>Recebimento de honorários por Pix</h2>
        <p className="pequeno">O Pix copia e cola é gerado com a chave abaixo, com valor e identificador de cada cobrança. O dinheiro cai direto na conta do escritório. Confira no extrato e registre o pagamento em Cobranças.</p>
        <Formulario acao={acaoConfigPix} className="campos campos-3">
          <Campo nome="chavePix" rotulo="Chave Pix" valor={cfg?.chavePix} obrigatorio ajuda="CNPJ só com números, e-mail, +55DDDNÚMERO ou chave aleatória." />
          <Campo nome="nomeRecebedor" rotulo="Nome do recebedor" valor={cfg?.nomeRecebedor} obrigatorio maxLength={25} ajuda="Como aparece no banco (até 25 letras)." />
          <Campo nome="cidadeRecebedor" rotulo="Cidade" valor={cfg?.cidadeRecebedor} obrigatorio maxLength={15} />
          <div className="ocupa-tudo"><BotaoEnviar>Salvar</BotaoEnviar></div>
        </Formulario>
      </section>
      <section className="cartao pilha">
        <h2>Serviços do servidor</h2>
        <dl className="definicoes">
          <div><dt>E-mail (relatórios agendados)</dt><dd>{emailConfigurado() ? <Selo tom="positivo">Configurado</Selo> : <Selo tom="atencao">Não configurado: relatórios ficam guardados no portal</Selo>}</dd></div>
          <div><dt>Rotinas diárias (avisos e envios)</dt><dd>{rotinas ? <Selo tom="positivo">Segredo configurado</Selo> : <Selo tom="atencao">Defina ROTINAS_SEGREDO e agende a chamada diária</Selo>}</dd></div>
          <div><dt>Boleto e aviso automático de pagamento</dt><dd><Selo tom="neutro">Provedor a definir</Selo></dd></div>
          <div><dt>Assinatura com certificado (ICP-Brasil)</dt><dd><Selo tom="neutro">Provedor a definir; hoje há aceite eletrônico simples no portal</Selo></dd></div>
        </dl>
      </section>
    </div>
  );
}
