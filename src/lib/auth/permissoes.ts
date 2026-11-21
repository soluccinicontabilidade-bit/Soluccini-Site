import type { PerfilUsuario, Prisma } from "@prisma/client";

export const NOME_PERFIL: Record<PerfilUsuario, string> = {
  ADMINISTRADOR: "Administrador do escritório",
  CONTADOR: "Contador responsável",
  ANALISTA_BPO: "Analista de BPO",
  ANALISTA_IRPF: "Analista de IRPF",
  CLIENTE_LEITOR: "Cliente leitor",
  CLIENTE_APROVADOR: "Cliente aprovador",
};

export type Acao =
  | "usuarios.gerenciar"
  | "carteiras.gerenciar"
  | "clientes.criar"
  | "clientes.editar"
  | "clientes.situacao"
  | "contratos.editar"
  | "documentos.enviar"
  | "importacao.clientes"
  | "area.interna"
  | "contabil.ver"
  | "contabil.lancar"
  | "contabil.plano"
  | "contabil.conferencia"
  | "contabil.fechar"
  | "contabil.importar"
  | "financeiro.ver"
  | "financeiro.operar"
  | "financeiro.config"
  | "irpf.ver"
  | "irpf.operar"
  | "irpf.tabelas";

const INTERNOS: PerfilUsuario[] = ["ADMINISTRADOR", "CONTADOR", "ANALISTA_BPO", "ANALISTA_IRPF"];

const REGRAS: Record<Acao, PerfilUsuario[]> = {
  "usuarios.gerenciar": ["ADMINISTRADOR"],
  "carteiras.gerenciar": ["ADMINISTRADOR"],
  "clientes.criar": ["ADMINISTRADOR", "CONTADOR"],
  "clientes.editar": INTERNOS,
  "clientes.situacao": ["ADMINISTRADOR", "CONTADOR"],
  "contratos.editar": ["ADMINISTRADOR", "CONTADOR"],
  "documentos.enviar": INTERNOS,
  "importacao.clientes": ["ADMINISTRADOR", "CONTADOR"],
  "area.interna": INTERNOS,
  "contabil.ver": INTERNOS,
  "contabil.lancar": ["ADMINISTRADOR", "CONTADOR", "ANALISTA_BPO"],
  "contabil.plano": ["ADMINISTRADOR", "CONTADOR"],
  "contabil.conferencia": ["ADMINISTRADOR", "CONTADOR", "ANALISTA_BPO"],
  "contabil.fechar": ["CONTADOR"],
  "contabil.importar": ["ADMINISTRADOR", "CONTADOR"],
  "financeiro.ver": INTERNOS,
  "financeiro.operar": ["ADMINISTRADOR", "CONTADOR", "ANALISTA_BPO"],
  "financeiro.config": ["ADMINISTRADOR", "CONTADOR"],
  "irpf.ver": INTERNOS,
  "irpf.operar": ["ADMINISTRADOR", "CONTADOR", "ANALISTA_IRPF"],
  "irpf.tabelas": ["ADMINISTRADOR"],
};

export const pode = (perfil: PerfilUsuario, acao: Acao) => REGRAS[acao].includes(perfil);

export const vePropriaCarteira = (perfil: PerfilUsuario) =>
  perfil === "ANALISTA_BPO" || perfil === "ANALISTA_IRPF";

/**
 * Quais clientes o usuário enxerga. Administrador e contador: todos do
 * escritório. Analista: só os das carteiras pelas quais responde. Cliente:
 * só os liberados em AcessoCliente. O isolamento entre escritórios já é
 * garantido pelo banco; este filtro é a camada de dentro do escritório.
 */
export function filtroClientes(usuario: { id: string; perfil: PerfilUsuario }): Prisma.ClienteWhereInput {
  const base: Prisma.ClienteWhereInput = { excluidoEm: null };
  if (usuario.perfil === "ADMINISTRADOR" || usuario.perfil === "CONTADOR") return base;
  if (vePropriaCarteira(usuario.perfil)) {
    return { ...base, carteiras: { some: { carteira: { responsavelId: usuario.id } } } };
  }
  return { ...base, acessos: { some: { usuarioId: usuario.id } } };
}
