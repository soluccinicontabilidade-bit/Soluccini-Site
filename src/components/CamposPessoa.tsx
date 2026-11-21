"use client";

import { useState } from "react";
import { Campo, useEstadoForm } from "./Formulario";

const REGIMES = [
  { valor: "", rotulo: "Escolha" },
  { valor: "MEI", rotulo: "MEI" },
  { valor: "SIMPLES_NACIONAL", rotulo: "Simples Nacional" },
  { valor: "LUCRO_PRESUMIDO", rotulo: "Lucro Presumido" },
  { valor: "LUCRO_REAL", rotulo: "Lucro Real" },
];
const UFS = ["", "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

export type ValoresPessoa = Partial<Record<string, string | null>>;

export function CamposPessoa({ inicial = {}, tipoFixo }: { inicial?: ValoresPessoa; tipoFixo?: "PF" | "PJ" }) {
  const estado = useEstadoForm();
  const [tipo, setTipo] = useState<"PF" | "PJ">((tipoFixo ?? estado.valores?.tipo ?? inicial.tipo ?? "PJ") as "PF" | "PJ");
  const v = (k: string) => inicial[k] ?? "";
  const pj = tipo === "PJ";

  return (
    <div className="pilha" style={{ gap: 24 }}>
      <fieldset>
        <legend>Tipo de pessoa</legend>
        {tipoFixo ? (
          <>
            <input type="hidden" name="tipo" value={tipoFixo} />
            <p>{tipoFixo === "PJ" ? "Pessoa jurídica" : "Pessoa física"}</p>
          </>
        ) : (
          <div className="linha" style={{ gap: 24 }}>
            {(["PJ", "PF"] as const).map((t) => (
              <label key={t} className="opcao">
                <input type="radio" name="tipo" value={t} checked={tipo === t} onChange={() => setTipo(t)} />
                {t === "PJ" ? "Pessoa jurídica (CNPJ)" : "Pessoa física (CPF)"}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="campos campos-2">
        <Campo nome="documento" rotulo={pj ? "CNPJ" : "CPF"} valor={v("documento")} obrigatorio inputMode="numeric"
          placeholder={pj ? "00.000.000/0000-00" : "000.000.000-00"} />
        <Campo nome="nome" rotulo={pj ? "Razão social" : "Nome completo"} valor={v("nome")} obrigatorio />
        {pj ? (
          <>
            <Campo nome="nomeFantasia" rotulo="Nome fantasia" valor={v("nomeFantasia")} />
            <Campo nome="regimeTributario" rotulo="Regime tributário" valor={v("regimeTributario")} opcoes={REGIMES} />
            <Campo nome="cnaePrincipal" rotulo="CNAE principal" valor={v("cnaePrincipal")} placeholder="0000-0/00" inputMode="numeric" />
            <Campo nome="dataAbertura" rotulo="Data de abertura" tipo="date" valor={v("dataAbertura")} />
            <Campo nome="inscricaoEstadual" rotulo="Inscrição estadual" valor={v("inscricaoEstadual")} />
            <Campo nome="inscricaoMunicipal" rotulo="Inscrição municipal" valor={v("inscricaoMunicipal")} />
          </>
        ) : (
          <Campo nome="dataNascimento" rotulo="Data de nascimento" tipo="date" valor={v("dataNascimento")} />
        )}
      </div>

      <fieldset>
        <legend>Contato</legend>
        <div className="campos campos-2">
          <Campo nome="email" rotulo="E-mail" tipo="email" valor={v("email")} inputMode="email" />
          <Campo nome="telefone" rotulo="Telefone ou WhatsApp" tipo="tel" valor={v("telefone")} inputMode="tel" />
        </div>
      </fieldset>

      <fieldset>
        <legend>Endereço</legend>
        <div className="campos campos-3">
          <Campo nome="cep" rotulo="CEP" valor={v("cep")} inputMode="numeric" placeholder="00000-000" />
          <Campo nome="logradouro" rotulo="Logradouro" valor={v("logradouro")} className="ocupa-2" />
          <Campo nome="numero" rotulo="Número" valor={v("numero")} />
          <Campo nome="complemento" rotulo="Complemento" valor={v("complemento")} />
          <Campo nome="bairro" rotulo="Bairro" valor={v("bairro")} />
          <Campo nome="municipio" rotulo="Município" valor={v("municipio")} />
          <Campo nome="uf" rotulo="UF" valor={v("uf")} opcoes={UFS.map((u) => ({ valor: u, rotulo: u || "Escolha" }))} />
        </div>
      </fieldset>
    </div>
  );
}
