import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search, Users } from "lucide-react";
import type { SituacaoCliente } from "@prisma/client";
import { exigirAcesso } from "@/lib/auth/sessao";
import { pode } from "@/lib/auth/permissoes";
import { comEscritorio } from "@/lib/db";
import { listarClientes, NOME_REGIME, NOME_SITUACAO } from "@/lib/clientes";
import { mascararDocumento } from "@/lib/br";
import { SeloSituacao } from "@/components/Selo";

export const metadata: Metadata = { title: "Clientes" };

const SITUACOES = Object.keys(NOME_SITUACAO) as SituacaoCliente[];

export default async function Clientes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { usuario, ctx } = await exigirAcesso();
  const p = await searchParams;
  const situacao = SITUACOES.includes(p.situacao as SituacaoCliente) ? (p.situacao as SituacaoCliente) : undefined;
  const autor = { id: usuario.id, escritorioId: usuario.escritorioId, perfil: usuario.perfil };

  const { clientes, etiquetas, carteiras } = await comEscritorio(ctx, async (tx) => ({
    clientes: await listarClientes(tx, autor, { busca: p.busca, situacao, etiquetaId: p.etiqueta || undefined, carteiraId: p.carteira || undefined }),
    etiquetas: await tx.etiqueta.findMany({ orderBy: { nome: "asc" } }),
    carteiras: await tx.carteira.findMany({ orderBy: { nome: "asc" } }),
  }));
  const filtrando = !!(p.busca || situacao || p.etiqueta || p.carteira);

  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <h1>Clientes</h1>
          <p className="suave">{usuario.perfil.startsWith("ANALISTA") ? "Clientes da sua carteira." : "Todos os clientes do escritório."}</p>
        </div>
        {pode(usuario.perfil, "clientes.criar") && (
          <Link className="botao" href="/clientes/novo"><Plus size={18} aria-hidden /> Cadastrar cliente</Link>
        )}
      </div>

      <form className="cartao pilha" role="search">
        <div className="linha" style={{ alignItems: "flex-end" }}>
          <div className="campo" style={{ flex: "1 1 220px" }}>
            <label htmlFor="busca">Buscar</label>
            <input id="busca" name="busca" type="search" defaultValue={p.busca ?? ""} placeholder="Nome, código ou CPF/CNPJ" />
          </div>
          <button className="botao" type="submit"><Search size={18} aria-hidden /> Buscar</button>
        </div>
        <details className="painel-form" open={!!(situacao || p.etiqueta || p.carteira)}>
          <summary>Mais filtros</summary>
          <div className="campos campos-3">
            <div className="campo">
              <label htmlFor="situacao">Situação</label>
              <select id="situacao" name="situacao" defaultValue={situacao ?? ""}>
                <option value="">Todas</option>
                {SITUACOES.map((s) => <option key={s} value={s}>{NOME_SITUACAO[s]}</option>)}
              </select>
            </div>
            {carteiras.length > 0 && (
              <div className="campo">
                <label htmlFor="carteira">Carteira</label>
                <select id="carteira" name="carteira" defaultValue={p.carteira ?? ""}>
                  <option value="">Todas</option>
                  {carteiras.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
            )}
            {etiquetas.length > 0 && (
              <div className="campo">
                <label htmlFor="etiqueta">Etiqueta</label>
                <select id="etiqueta" name="etiqueta" defaultValue={p.etiqueta ?? ""}>
                  <option value="">Todas</option>
                  {etiquetas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </div>
            )}
            <div className="ocupa-tudo"><button className="botao secundario" type="submit">Aplicar filtros</button></div>
          </div>
        </details>
        {filtrando && <Link className="botao texto" href="/clientes" style={{ justifySelf: "start" }}>Limpar filtros</Link>}
      </form>

      <p className="suave pequeno" role="status">{clientes.length} cliente(s){filtrando ? " encontrado(s)" : ""}.</p>

      {clientes.length === 0 ? (
        <div className="cartao vazio">
          <Users size={32} aria-hidden />
          <p>{filtrando ? "Nenhum cliente com esses filtros." : "Nenhum cliente por aqui ainda."}</p>
        </div>
      ) : (
        <ul className="lista-clientes">
          {clientes.map((c) => (
            <li key={c.id}>
              <Link className="item" href={`/clientes/${c.id}`}>
                <span className="suave num pequeno">nº {c.codigo}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="nome">{c.pessoa.nome}</span>
                  <span className="suave pequeno" style={{ display: "block" }}>
                    {mascararDocumento(c.pessoa.tipo, c.pessoa.documentoFinal)}
                    {c.pessoa.nomeFantasia ? ` · ${c.pessoa.nomeFantasia}` : ""}
                  </span>
                </span>
                <span className="pequeno">
                  {c.pessoa.tipo === "PJ" ? (c.pessoa.regimeTributario ? NOME_REGIME[c.pessoa.regimeTributario] : "PJ, regime não informado") : "Pessoa física"}
                </span>
                <span className="pequeno suave">
                  {c.carteiras.map((k) => k.carteira.responsavel.nome.split(" ")[0]).join(", ") || "Sem carteira"}
                  {c.etiquetas.length > 0 && (
                    <span className="linha" style={{ marginTop: 4, gap: 4 }}>
                      {c.etiquetas.map((e) => <span key={e.etiquetaId} className="etiqueta">{e.etiqueta.nome}</span>)}
                    </span>
                  )}
                </span>
                <SeloSituacao situacao={c.situacao} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
