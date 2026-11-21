import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { sessaoAtual } from "@/lib/auth/sessao";
import { prepararTotp } from "@/lib/auth/login";
import { qrCodeTotp } from "@/lib/auth/totp";
import { acaoSair } from "../acoes";
import { Ativacao } from "./Ativacao";

export const metadata: Metadata = { title: "Ativar verificação em duas etapas" };

export default async function Ativar2fa() {
  const s = await sessaoAtual();
  if (!s) redirect("/entrar");
  if (s.usuario.totpAtivo) redirect(s.doisFatoresOk ? "/" : "/entrar/verificacao");
  const segredo = await prepararTotp(s);
  const qr = await qrCodeTotp(segredo, s.usuario.email);
  return (
    <main className="entrada">
      <div className="caixa-entrada">
        <Logo />
        <div className="cartao pilha">
          <div className="pilha" style={{ gap: 4 }}>
            <h1>Proteja seu acesso</h1>
            <p className="suave">Para proteger os dados dos clientes, todo acesso usa senha e um código do celular. Leva um minuto.</p>
          </div>
          <Ativacao qr={qr} segredo={segredo} />
          <form action={acaoSair}><button className="botao texto" type="submit">Sair</button></form>
        </div>
      </div>
    </main>
  );
}
