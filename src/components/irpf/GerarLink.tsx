"use client";

import { useActionState, useTransition } from "react";
import { Copy, Link2 } from "lucide-react";
import type { EstadoForm } from "@/lib/form";

export function GerarLink({ acao }: { acao: (e: EstadoForm) => Promise<EstadoForm> }) {
  const [estado, despachar] = useActionState<EstadoForm>(acao, {});
  const [pendente, iniciar] = useTransition();
  const link = estado.dados?.link as string | undefined;
  return (
    <div className="pilha" style={{ gap: 8 }}>
      <button type="button" className="botao secundario pequeno" disabled={pendente} onClick={() => iniciar(() => despachar())} style={{ justifySelf: "start" }}>
        <Link2 size={16} aria-hidden /> Gerar link de envio para o contribuinte
      </button>
      {estado.mensagem && <p className={`pequeno ${estado.ok ? "" : "erro-campo"}`} role="status">{estado.mensagem}</p>}
      {link && (
        <div className="linha">
          <input readOnly value={link} aria-label="Link de envio" style={{ flex: 1 }} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="botao pequeno" onClick={() => navigator.clipboard?.writeText(link)}><Copy size={16} aria-hidden /> Copiar</button>
        </div>
      )}
    </div>
  );
}
