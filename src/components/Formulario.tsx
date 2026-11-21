"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useTransition, type ReactNode } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { EstadoForm } from "@/lib/form";

const Ctx = createContext<EstadoForm>({});

/**
 * Formulário ligado a uma ação do servidor. Mostra a mensagem geral e os
 * erros por campo, e mantém o que foi digitado quando há erro.
 */
export function Formulario({
  acao,
  children,
  className,
  limparAoConcluir = false,
  confirmar,
}: {
  acao: (anterior: EstadoForm, dados: FormData) => Promise<EstadoForm>;
  children: ReactNode;
  className?: string;
  limparAoConcluir?: boolean;
  confirmar?: string;
}) {
  const [estado, despachar] = useActionState(acao, {});
  const [pendente, iniciar] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  const avisoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (estado.ok && limparAoConcluir) ref.current?.reset();
    if (estado.mensagem) avisoRef.current?.focus();
  }, [estado, limparAoConcluir]);

  return (
    <Ctx.Provider value={estado}>
      <form
        ref={ref}
        className={className}
        aria-busy={pendente}
        onSubmit={(e) => {
          e.preventDefault();
          if (confirmar && !window.confirm(confirmar)) return;
          const dados = new FormData(e.currentTarget);
          iniciar(() => despachar(dados));
        }}
      >
        <fieldset disabled={pendente} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "contents" }}>
          {estado.mensagem && (
            <div ref={avisoRef} tabIndex={-1} role={estado.ok ? "status" : "alert"} className={`aviso ${estado.ok ? "positivo" : "erro"}`}>
              {estado.ok ? <CheckCircle2 size={20} aria-hidden /> : <AlertCircle size={20} aria-hidden />}
              <span>{estado.mensagem}</span>
            </div>
          )}
          {children}
        </fieldset>
      </form>
    </Ctx.Provider>
  );
}

export const useEstadoForm = () => useContext(Ctx);

type PropsCampo = {
  nome: string;
  rotulo: string;
  tipo?: string;
  ajuda?: string;
  valor?: string | null;
  obrigatorio?: boolean;
  className?: string;
  opcoes?: { valor: string; rotulo: string }[];
  autoComplete?: string;
  inputMode?: "text" | "numeric" | "decimal" | "email" | "tel";
  placeholder?: string;
  maxLength?: number;
  aceitar?: string;
};

export function Campo({ nome, rotulo, tipo = "text", ajuda, valor, obrigatorio, className, opcoes, autoComplete, inputMode, placeholder, maxLength, aceitar }: PropsCampo) {
  const estado = useEstadoForm();
  const erro = estado.erros?.[nome];
  const anterior = estado.valores?.[nome];
  const id = `campo-${nome}`;
  const descricao = [ajuda ? `${id}-ajuda` : "", erro ? `${id}-erro` : ""].filter(Boolean).join(" ") || undefined;
  const comum = {
    id,
    name: nome,
    required: obrigatorio,
    "aria-invalid": erro ? true : undefined,
    "aria-describedby": descricao,
  } as const;
  // `key` força o campo a mostrar o valor reenviado depois de um erro.
  const chave = `${nome}-${anterior ?? valor ?? ""}-${estado.versao ?? 0}`;
  return (
    <div className={`campo ${className ?? ""}`}>
      <label htmlFor={id}>
        {rotulo}
        {obrigatorio && <span aria-hidden> *</span>}
      </label>
      {opcoes ? (
        <select key={chave} {...comum} defaultValue={anterior ?? valor ?? ""}>
          {opcoes.map((o) => (
            <option key={o.valor} value={o.valor}>{o.rotulo}</option>
          ))}
        </select>
      ) : tipo === "textarea" ? (
        <textarea key={chave} {...comum} defaultValue={anterior ?? valor ?? ""} rows={3} maxLength={maxLength} />
      ) : (
        <input
          key={tipo === "file" ? undefined : chave}
          {...comum}
          type={tipo}
          defaultValue={tipo === "file" || tipo === "password" ? undefined : (anterior ?? valor ?? "")}
          autoComplete={autoComplete}
          inputMode={inputMode}
          placeholder={placeholder}
          maxLength={maxLength}
          accept={aceitar}
        />
      )}
      {ajuda && <span id={`${id}-ajuda`} className="ajuda">{ajuda}</span>}
      {erro && <span id={`${id}-erro`} className="erro-campo">{erro}</span>}
    </div>
  );
}

export function BotaoEnviar({ children, className, nome, valor }: { children: ReactNode; className?: string; nome?: string; valor?: string }) {
  return (
    <button type="submit" className={`botao ${className ?? ""}`} name={nome} value={valor}>
      {children}
    </button>
  );
}
