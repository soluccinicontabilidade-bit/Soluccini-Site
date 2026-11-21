"use client";

import { useActionState, useTransition } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { EstadoForm } from "@/lib/form";
import { acaoAtivar2fa } from "../acoes";

export function Ativacao({ qr, segredo }: { qr: string; segredo: string }) {
  const [estado, despachar] = useActionState<EstadoForm, FormData>(acaoAtivar2fa, {});
  const [pendente, iniciar] = useTransition();
  const codigos = (estado.dados?.codigos as string[] | undefined) ?? null;

  if (codigos) {
    return (
      <div className="pilha">
        <div className="aviso positivo" role="status"><CheckCircle2 size={20} aria-hidden /> Verificação em duas etapas ativada.</div>
        <h2>Guarde seus códigos de recuperação</h2>
        <p>Cada código funciona uma única vez, se você ficar sem o celular. Eles não serão mostrados de novo.</p>
        <div className="codigos" aria-label="Códigos de recuperação">{codigos.map((c) => <span key={c}>{c}</span>)}</div>
        <div className="linha">
          <button type="button" className="botao secundario" onClick={() => navigator.clipboard?.writeText(codigos.join("\n"))}>Copiar códigos</button>
          <Link className="botao" href="/">Já guardei, continuar</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pilha">
      <ol className="pilha" style={{ paddingLeft: 20, margin: 0, gap: 8 }}>
        <li>Instale um aplicativo autenticador no celular (Google Authenticator, Microsoft Authenticator ou similar).</li>
        <li>No aplicativo, escolha adicionar conta e leia o QR code abaixo.</li>
        <li>Digite o código de 6 dígitos que aparecer.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="qr" src={qr} width={220} height={220} alt="QR code para cadastrar a SOLUCCINI no aplicativo autenticador" />
      <details>
        <summary className="pequeno">Não consegue ler o QR code? Digite a chave</summary>
        <p className="segredo" style={{ marginTop: 8 }}>{segredo}</p>
      </details>
      <form
        className="campos"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          iniciar(() => despachar(f));
        }}
      >
        {estado.mensagem && <div className="aviso erro" role="alert"><AlertCircle size={20} aria-hidden /> {estado.mensagem}</div>}
        <div className="campo">
          <label htmlFor="codigo">Código de 6 dígitos</label>
          <input id="codigo" name="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required aria-invalid={!!estado.erros?.codigo} />
        </div>
        <button className="botao" type="submit" disabled={pendente}>Ativar</button>
      </form>
    </div>
  );
}
