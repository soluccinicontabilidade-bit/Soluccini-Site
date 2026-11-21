import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { BotaoEnviar, Formulario } from "@/components/Formulario";
import { formatarData } from "@/lib/br";
import { lerLinkEnvio } from "@/lib/irpf/irpf";
import { acaoEnviarPeloLink } from "./acoes";

export const metadata: Metadata = { title: "Envio de documentos", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function Enviar({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const d = await lerLinkEnvio(token);
  return (
    <main className="entrada" style={{ placeItems: "start center" }}>
      <div className="caixa-entrada" style={{ maxWidth: 680 }}>
        <Logo />
        {!d ? (
          <div className="cartao pilha"><h1>Link indisponível</h1><p>Este link expirou ou foi desativado. Peça um novo ao escritório.</p></div>
        ) : (
          <div className="cartao pilha">
            <h1>Olá, {d.primeiroNome}.</h1>
            <p>Para preparar sua declaração de Imposto de Renda (ano-calendário {d.ano}), precisamos dos documentos abaixo. Envie cada um no item correspondente. Se algum não se aplica a você, é só deixar em branco e avisar o escritório.</p>
            <p className="pequeno suave">Arquivos em PDF ou foto, até 20 MB cada. O link vale até {formatarData(d.expiraEm)}. Os arquivos são guardados cifrados.</p>
            <ul className="pilha" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {d.itens.map((i) => (
                <li key={i.id} className="partida-linha" style={{ display: "grid", gap: 8 }}>
                  <div><span className="pequeno suave">{i.categoria}</span><br />{i.descricao}</div>
                  {i.enviado ? <span className="pequeno" style={{ color: "var(--positivo)" }}><CheckCircle2 size={16} aria-hidden style={{ verticalAlign: "-3px" }} /> Recebido. Pode enviar outro arquivo, se houver.</span> : null}
                  <Formulario acao={acaoEnviarPeloLink.bind(null, token, i.id)} className="linha" limparAoConcluir>
                    <input type="file" name="arquivo" accept=".pdf,.png,.jpg,.jpeg" aria-label={`Arquivo: ${i.descricao}`} style={{ flex: 1, minWidth: 200 }} />
                    <BotaoEnviar className="pequeno">Enviar</BotaoEnviar>
                  </Formulario>
                </li>
              ))}
            </ul>
            <p className="pequeno suave">{d.escritorio}</p>
          </div>
        )}
      </div>
    </main>
  );
}
