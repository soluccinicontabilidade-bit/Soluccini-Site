import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAcesso } from "@/lib/auth/sessao";
import { comEscritorio } from "@/lib/db";
import { documentoEmClaro, obterClienteVisivel } from "@/lib/clientes";
import { formatarDocumento, isoData } from "@/lib/br";
import { BotaoEnviar, Formulario } from "@/components/Formulario";
import { CamposPessoa } from "@/components/CamposPessoa";
import { acaoAtualizarCliente } from "../../acoes";

export const metadata: Metadata = { title: "Editar cliente" };

export default async function EditarCliente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { usuario, ctx } = await exigirAcesso("clientes.editar");
  const c = await comEscritorio(ctx, (tx) => obterClienteVisivel(tx, { id: usuario.id, escritorioId: usuario.escritorioId, perfil: usuario.perfil }, id));
  if (!c) notFound();
  const p = c.pessoa;
  const inicial = {
    tipo: p.tipo, documento: formatarDocumento(p.tipo, documentoEmClaro(p)), nome: p.nome, nomeFantasia: p.nomeFantasia,
    dataNascimento: isoData(p.dataNascimento), dataAbertura: isoData(p.dataAbertura), regimeTributario: p.regimeTributario,
    cnaePrincipal: p.cnaePrincipal, inscricaoEstadual: p.inscricaoEstadual, inscricaoMunicipal: p.inscricaoMunicipal,
    email: p.email, telefone: p.telefone, cep: p.cep, logradouro: p.logradouro, numero: p.numero, complemento: p.complemento,
    bairro: p.bairro, municipio: p.municipio, uf: p.uf,
  };
  return (
    <div className="pilha" style={{ gap: 24 }}>
      <div className="cabecalho">
        <div className="sobre">
          <span className="trilha"><Link href="/clientes">Clientes</Link> / <Link href={`/clientes/${id}`}>{p.nome}</Link> / Editar</span>
          <h1>Editar dados cadastrais</h1>
        </div>
      </div>
      <Formulario acao={acaoAtualizarCliente.bind(null, id)} className="cartao pilha">
        <CamposPessoa inicial={inicial} tipoFixo={p.tipo} />
        <div className="linha">
          <BotaoEnviar>Salvar alterações</BotaoEnviar>
          <Link className="botao secundario" href={`/clientes/${id}`}>Cancelar</Link>
        </div>
      </Formulario>
    </div>
  );
}
