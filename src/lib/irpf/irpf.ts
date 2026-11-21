import type { CategoriaItemIRPF, ModeloDeclaracao, PerfilUsuario, Prisma, SituacaoDeclaracao, SituacaoItemIRPF } from "@prisma/client";
import { comLinkPublico, definirContexto, type Tx } from "@/lib/db";
import { ErroDeNegocio } from "@/lib/erros";
import { sha256, tokenAleatorio } from "@/lib/cripto";
import { dataCivil, formatarReais, lerData, reaisParaCentavos } from "@/lib/br";
import { obterClienteVisivel } from "@/lib/clientes";
import { enviarDocumento, type ArquivoRecebido } from "@/lib/documentos";
import { calcularAnual, REFERENCIA_2026, validarParametros, type ParametrosIRPF } from "./calculo";

interface Autor {
  id: string;
  escritorioId: string;
  perfil: PerfilUsuario;
}

export const NOME_SITUACAO_DECL: Record<SituacaoDeclaracao, string> = {
  AGUARDANDO_DOCUMENTOS: "Aguardando documentos",
  EM_ANALISE: "Em análise",
  EM_DIGITACAO: "Em digitação",
  EM_REVISAO: "Em revisão",
  TRANSMITIDA: "Transmitida",
  MALHA_FINA: "Malha fina",
  FINALIZADA: "Restituição ou pagamento concluído",
};
export const ORDEM_FUNIL: SituacaoDeclaracao[] = ["AGUARDANDO_DOCUMENTOS", "EM_ANALISE", "EM_DIGITACAO", "EM_REVISAO", "TRANSMITIDA", "MALHA_FINA", "FINALIZADA"];

export const NOME_CATEGORIA_ITEM: Record<CategoriaItemIRPF, string> = {
  INFORME_RENDIMENTOS: "Informes de rendimentos",
  SAUDE: "Saúde",
  EDUCACAO: "Educação",
  PREVIDENCIA: "Previdência",
  DEPENDENTES: "Dependentes",
  BENS_DIREITOS: "Bens e direitos",
  DIVIDAS: "Dívidas e ônus",
  ALUGUEIS: "Aluguéis",
  CARNE_LEAO: "Carnê-leão",
  RENDA_VARIAVEL: "Renda variável (bolsa)",
  GANHO_CAPITAL: "Ganho de capital",
  OUTROS: "Outros",
};
export const NOME_SITUACAO_ITEM: Record<SituacaoItemIRPF, string> = { PENDENTE: "Pendente", RECEBIDO: "Recebido", CONFERIDO: "Conferido", NAO_SE_APLICA: "Não se aplica" };

const ITENS_PADRAO: [CategoriaItemIRPF, string][] = [
  ["INFORME_RENDIMENTOS", "Informes de rendimentos do trabalho (empresas e órgãos pagadores)"],
  ["INFORME_RENDIMENTOS", "Informes de rendimentos de bancos e corretoras"],
  ["SAUDE", "Recibos e notas de despesas médicas, odontológicas e plano de saúde"],
  ["EDUCACAO", "Comprovantes de escola, faculdade e pós-graduação"],
  ["PREVIDENCIA", "Informe de previdência privada (PGBL/VGBL)"],
  ["DEPENDENTES", "CPF e dados dos dependentes"],
  ["BENS_DIREITOS", "Documentos de compra e venda de imóveis, veículos e outros bens"],
  ["DIVIDAS", "Contratos de financiamentos e empréstimos"],
  ["ALUGUEIS", "Recibos de aluguéis recebidos ou pagos"],
  ["CARNE_LEAO", "Carnê-leão e DARFs pagos"],
  ["RENDA_VARIAVEL", "Notas de corretagem e apuração mensal da bolsa"],
  ["GANHO_CAPITAL", "Documentos de venda de bens com lucro (GCAP)"],
  ["OUTROS", "Declaração e recibo do ano anterior"],
];

// ---------------------------------------------------------------------------
// Tabelas por ano
// ---------------------------------------------------------------------------

export async function tabelaDoAno(tx: Tx, escritorioId: string, ano: number) {
  const t = await tx.tabelaIRPF.findUnique({ where: { escritorioId_anoCalendario: { escritorioId, anoCalendario: ano } } });
  if (t || ano !== 2026) return t;
  return tx.tabelaIRPF.create({
    data: { escritorioId, anoCalendario: 2026, parametros: REFERENCIA_2026 as unknown as Prisma.InputJsonValue, confirmada: false, fonte: "Lei 15.270/2025: valores de referência a confirmar na Receita Federal" },
  });
}

export async function salvarTabela(tx: Tx, autor: Autor, ano: number, e: { parametros: string; confirmada: boolean; fonte: string; prazoEntrega?: string }) {
  if (autor.perfil !== "ADMINISTRADOR") throw new ErroDeNegocio("Só o administrador edita as tabelas do IRPF.");
  let p: ParametrosIRPF;
  try {
    p = validarParametros(JSON.parse(e.parametros));
  } catch (err) {
    throw new ErroDeNegocio(err instanceof Error ? err.message : "JSON inválido.");
  }
  if (e.confirmada && !e.fonte.trim()) throw new ErroDeNegocio("Para marcar como confirmada, informe a fonte oficial (ato, link ou data da consulta).");
  const dados = { parametros: p as unknown as Prisma.InputJsonValue, confirmada: e.confirmada, fonte: e.fonte.trim() || null, prazoEntrega: e.prazoEntrega ? lerData(e.prazoEntrega) : null, atualizadoPorId: autor.id };
  await tx.tabelaIRPF.upsert({ where: { escritorioId_anoCalendario: { escritorioId: autor.escritorioId, anoCalendario: ano } }, create: { escritorioId: autor.escritorioId, anoCalendario: ano, ...dados }, update: dados });
}

// ---------------------------------------------------------------------------
// Declarações
// ---------------------------------------------------------------------------

async function evento(tx: Tx, autor: { id: string | null; escritorioId: string }, declaracaoId: string, resumo: string) {
  await tx.eventoDeclaracao.create({ data: { escritorioId: autor.escritorioId, declaracaoId, resumo, usuarioId: autor.id } });
}

export async function declaracaoVisivel(tx: Tx, autor: Autor, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const d = await tx.declaracaoIRPF.findUnique({ where: { id }, include: { pessoa: true } });
  if (!d || !(await obterClienteVisivel(tx, autor, d.clienteId))) return null;
  return d;
}

export async function criarDeclaracao(tx: Tx, autor: Autor, e: { pessoaId: string; clienteId: string; ano: number; responsavelId?: string; honorario?: string; prazo?: string }) {
  const cliente = await obterClienteVisivel(tx, autor, e.clienteId);
  if (!cliente) throw new ErroDeNegocio("Escolha o cliente contratante.");
  const pessoa = await tx.pessoa.findUnique({ where: { id: e.pessoaId } });
  if (!pessoa || pessoa.tipo !== "PF") throw new ErroDeNegocio("Escolha a pessoa física contribuinte.");
  // O contribuinte é o próprio cliente PF ou sócio de um cliente PJ.
  if (cliente.pessoaId !== pessoa.id && !(await tx.vinculoSocietario.findFirst({ where: { empresaId: cliente.pessoaId, socioId: pessoa.id } }))) {
    throw new ErroDeNegocio("O contribuinte precisa ser o próprio cliente ou sócio da empresa cliente.");
  }
  if (!Number.isInteger(e.ano) || e.ano < 2000 || e.ano > 2100) throw new ErroDeNegocio("Ano-calendário inválido.");
  if (await tx.declaracaoIRPF.findUnique({ where: { pessoaId_anoCalendario: { pessoaId: pessoa.id, anoCalendario: e.ano } } })) throw new ErroDeNegocio(`${pessoa.nome} já tem declaração do ano-calendário ${e.ano}.`);
  const tabela = await tabelaDoAno(tx, autor.escritorioId, e.ano);
  let honorario: bigint | null = null;
  if (e.honorario) {
    try {
      honorario = reaisParaCentavos(e.honorario);
    } catch {
      throw new ErroDeNegocio("Honorário inválido.");
    }
  }
  const d = await tx.declaracaoIRPF.create({
    data: {
      escritorioId: autor.escritorioId, pessoaId: pessoa.id, clienteId: cliente.id, anoCalendario: e.ano, responsavelId: e.responsavelId || null,
      honorarioCentavos: honorario, prazo: e.prazo ? lerData(e.prazo) : tabela?.prazoEntrega ?? null,
      itens: { create: ITENS_PADRAO.map(([categoria, descricao]) => ({ escritorioId: autor.escritorioId, categoria, descricao })) },
    },
  });
  await evento(tx, autor, d.id, `Declaração do ano-calendário ${e.ano} aberta`);
  return d;
}

export interface MudancaSituacao {
  para: SituacaoDeclaracao;
  recibo?: string;
  transmitidaEm?: string;
  resultado?: string; // "1.234,56" a pagar ou "-1.234,56" a restituir
  modelo?: ModeloDeclaracao;
  pendenciasMalha?: string;
  retificar?: boolean;
}

export async function mudarSituacaoDeclaracao(tx: Tx, autor: Autor, id: string, e: MudancaSituacao) {
  const d = await declaracaoVisivel(tx, autor, id);
  if (!d) throw new ErroDeNegocio("Declaração não encontrada.");
  if (!ORDEM_FUNIL.includes(e.para)) throw new ErroDeNegocio("Situação inválida.");
  const dados: Prisma.DeclaracaoIRPFUpdateInput = { situacao: e.para };
  if (e.retificar) {
    if (d.situacao !== "TRANSMITIDA" && d.situacao !== "MALHA_FINA" && d.situacao !== "FINALIZADA") throw new ErroDeNegocio("Só se retifica uma declaração já transmitida.");
    Object.assign(dados, { situacao: "EM_DIGITACAO", retificadora: true, retificacoes: d.retificacoes + 1 });
  }
  if (e.para === "TRANSMITIDA" && !e.retificar) {
    if (!e.recibo?.trim() || !e.transmitidaEm) throw new ErroDeNegocio("Informe o número do recibo e a data de transmissão.");
    let resultado: bigint | null = null;
    if (e.resultado?.trim()) {
      try {
        resultado = reaisParaCentavos(e.resultado);
      } catch {
        throw new ErroDeNegocio("Resultado inválido. Use 1.234,56 para pagar ou -1.234,56 para restituir.");
      }
    }
    Object.assign(dados, { recibo: e.recibo.trim(), transmitidaEm: lerData(e.transmitidaEm), resultadoCentavos: resultado, modelo: e.modelo ?? d.modelo });
  }
  if (e.para === "MALHA_FINA") {
    if (!e.pendenciasMalha?.trim()) throw new ErroDeNegocio("Descreva as pendências apontadas na malha fina.");
    dados.pendenciasMalha = e.pendenciasMalha.trim();
  }
  await tx.declaracaoIRPF.update({ where: { id }, data: dados });
  await evento(tx, autor, id, e.retificar ? `Retificadora nº ${d.retificacoes + 1} iniciada` : `${NOME_SITUACAO_DECL[d.situacao]} → ${NOME_SITUACAO_DECL[e.para]}${e.recibo ? ` (recibo ${e.recibo})` : ""}`);
}

export async function atualizarDeclaracao(tx: Tx, autor: Autor, id: string, e: { responsavelId?: string; honorario?: string; honorarioPago?: boolean; prazo?: string; observacoes?: string }) {
  const d = await declaracaoVisivel(tx, autor, id);
  if (!d) throw new ErroDeNegocio("Declaração não encontrada.");
  let honorario: bigint | null = d.honorarioCentavos;
  try {
    honorario = e.honorario ? reaisParaCentavos(e.honorario) : null;
  } catch {
    throw new ErroDeNegocio("Honorário inválido.");
  }
  await tx.declaracaoIRPF.update({
    where: { id },
    data: { responsavelId: e.responsavelId || null, honorarioCentavos: honorario, honorarioPago: !!e.honorarioPago, prazo: e.prazo ? lerData(e.prazo) : null, observacoes: e.observacoes?.trim() || null },
  });
}

export async function atualizarItem(tx: Tx, autor: Autor, declaracaoId: string, itemId: string, situacao: SituacaoItemIRPF, observacao?: string) {
  if (!(await declaracaoVisivel(tx, autor, declaracaoId))) throw new ErroDeNegocio("Declaração não encontrada.");
  const item = await tx.itemDocumentoIRPF.findFirst({ where: { id: itemId, declaracaoId } });
  if (!item) throw new ErroDeNegocio("Item não encontrado.");
  await tx.itemDocumentoIRPF.update({ where: { id: itemId }, data: { situacao, observacao: observacao?.trim() || item.observacao } });
}

export async function adicionarItem(tx: Tx, autor: Autor, declaracaoId: string, categoria: CategoriaItemIRPF, descricao: string) {
  if (!(await declaracaoVisivel(tx, autor, declaracaoId))) throw new ErroDeNegocio("Declaração não encontrada.");
  if (descricao.trim().length < 3) throw new ErroDeNegocio("Descreva o documento.");
  await tx.itemDocumentoIRPF.create({ data: { escritorioId: autor.escritorioId, declaracaoId, categoria, descricao: descricao.trim() } });
}

async function guardarNoItem(tx: Tx, autor: Autor, d: { id: string; clienteId: string; anoCalendario: number }, itemId: string, arquivo: ArquivoRecebido) {
  const item = await tx.itemDocumentoIRPF.findFirst({ where: { id: itemId, declaracaoId: d.id } });
  if (!item) throw new ErroDeNegocio("Item não encontrado.");
  const nomeCat = `IRPF ${d.anoCalendario}`;
  const cat = (await tx.categoriaDocumento.findFirst({ where: { nome: nomeCat } })) ?? (await tx.categoriaDocumento.create({ data: { escritorioId: autor.escritorioId, nome: nomeCat } }));
  const doc = await enviarDocumento(tx, autor, d.clienteId, { categoriaId: cat.id, titulo: `${NOME_CATEGORIA_ITEM[item.categoria]}: ${arquivo.nome}`.slice(0, 200), arquivo });
  await tx.itemDocumentoIRPF.update({ where: { id: item.id }, data: { situacao: item.situacao === "CONFERIDO" ? "CONFERIDO" : "RECEBIDO", documentoId: doc.id } });
  return item;
}

export async function anexarAoItem(tx: Tx, autor: Autor, declaracaoId: string, itemId: string, arquivo: ArquivoRecebido) {
  const d = await declaracaoVisivel(tx, autor, declaracaoId);
  if (!d) throw new ErroDeNegocio("Declaração não encontrada.");
  const item = await guardarNoItem(tx, autor, d, itemId, arquivo);
  await evento(tx, autor, d.id, `Documento recebido: ${item.descricao}`);
}

// ---------------------------------------------------------------------------
// Link de envio para o contribuinte
// ---------------------------------------------------------------------------

export async function gerarLinkEnvio(tx: Tx, autor: Autor, declaracaoId: string, dias = 30) {
  if (!(await declaracaoVisivel(tx, autor, declaracaoId))) throw new ErroDeNegocio("Declaração não encontrada.");
  await tx.linkEnvio.updateMany({ where: { declaracaoId, revogadoEm: null }, data: { revogadoEm: new Date() } });
  const token = tokenAleatorio(32);
  await tx.linkEnvio.create({ data: { escritorioId: autor.escritorioId, declaracaoId, tokenHash: sha256(token), expiraEm: new Date(Date.now() + dias * 86400_000), criadoPorId: autor.id } });
  await evento(tx, autor, declaracaoId, `Link de envio de documentos gerado (vale ${dias} dias)`);
  return token;
}

export async function revogarLinks(tx: Tx, autor: Autor, declaracaoId: string) {
  if (!(await declaracaoVisivel(tx, autor, declaracaoId))) throw new ErroDeNegocio("Declaração não encontrada.");
  await tx.linkEnvio.updateMany({ where: { declaracaoId, revogadoEm: null }, data: { revogadoEm: new Date() } });
}

/** Lê o link público. Devolve só o necessário para a página (nome e itens pendentes). */
export async function lerLinkEnvio(token: string) {
  if (!token || token.length > 100) return null;
  const hash = sha256(token);
  return comLinkPublico(hash, async (tx) => {
    const link = await tx.linkEnvio.findUnique({ where: { tokenHash: hash } });
    if (!link || link.revogadoEm || link.expiraEm < new Date()) return null;
    await definirContexto(tx, { escritorioId: link.escritorioId, origem: "web:link-envio" });
    const d = await tx.declaracaoIRPF.findUniqueOrThrow({ where: { id: link.declaracaoId }, include: { pessoa: { select: { nome: true } }, itens: { orderBy: { categoria: "asc" } } } });
    const esc = await tx.escritorio.findUniqueOrThrow({ where: { id: link.escritorioId }, select: { nome: true } });
    return {
      escritorio: esc.nome,
      primeiroNome: d.pessoa.nome.split(" ")[0],
      ano: d.anoCalendario,
      expiraEm: link.expiraEm,
      itens: d.itens.filter((i) => i.situacao !== "NAO_SE_APLICA").map((i) => ({ id: i.id, categoria: NOME_CATEGORIA_ITEM[i.categoria], descricao: i.descricao, enviado: i.situacao !== "PENDENTE" })),
    };
  });
}

export async function enviarPeloLink(token: string, itemId: string, arquivo: ArquivoRecebido) {
  const hash = sha256(token);
  return comLinkPublico(hash, async (tx) => {
    const link = await tx.linkEnvio.findUnique({ where: { tokenHash: hash } });
    if (!link || link.revogadoEm || link.expiraEm < new Date()) throw new ErroDeNegocio("Este link expirou. Peça um novo ao escritório.");
    await definirContexto(tx, { escritorioId: link.escritorioId, origem: "web:link-envio" });
    const d = await tx.declaracaoIRPF.findUniqueOrThrow({ where: { id: link.declaracaoId } });
    const enviosHoje = await tx.eventoDeclaracao.count({ where: { declaracaoId: d.id, usuarioId: null, ocorridoEm: { gte: new Date(Date.now() - 86400_000) } } });
    if (enviosHoje >= 100) throw new ErroDeNegocio("Limite de envios do dia atingido. Tente amanhã ou fale com o escritório.");
    // Autor de sistema: o envio é do contribuinte, sem usuário.
    const sistema = { id: link.criadoPorId, escritorioId: link.escritorioId, perfil: "ADMINISTRADOR" as PerfilUsuario };
    const item = await guardarNoItem(tx, sistema, d, itemId, arquivo);
    await tx.linkEnvio.update({ where: { id: link.id }, data: { ultimoUsoEm: new Date() } });
    await tx.declaracaoIRPF.update({ where: { id: d.id }, data: { ultimoContatoEm: new Date() } });
    await evento(tx, { id: null, escritorioId: link.escritorioId }, d.id, `Contribuinte enviou pelo link: ${item.descricao} (${arquivo.nome})`);
  });
}

// ---------------------------------------------------------------------------
// Dados vindos das empresas (pró-labore e lucros pagos pelos clientes PJ)
// ---------------------------------------------------------------------------

export interface ValorDaEmpresa {
  empresa: string;
  clienteId: string;
  tipo: "PRO_LABORE" | "DISTRIBUICAO_LUCROS";
  data: Date;
  descricao: string;
  valor: bigint;
}

export async function dadosDasEmpresas(tx: Tx, pessoaId: string, ano: number): Promise<ValorDaEmpresa[]> {
  const de = dataCivil(`${ano}-01-01`);
  const ate = dataCivil(`${ano}-12-31`);
  const parcelas = await tx.parcela.findMany({
    where: {
      situacao: "BAIXADA", dataBaixa: { gte: de, lte: ate },
      titulo: { tipo: "PAGAR", canceladoEm: null, favorecido: { pessoaId }, rateios: { some: { categoria: { especial: { in: ["PRO_LABORE", "DISTRIBUICAO_LUCROS"] } } } } },
    },
    include: { titulo: { include: { cliente: { include: { pessoa: { select: { nome: true } } } }, rateios: { include: { categoria: true } } } } },
    orderBy: { dataBaixa: "asc" },
  });
  const linhas: ValorDaEmpresa[] = [];
  for (const p of parcelas) {
    for (const r of p.titulo.rateios) {
      if (r.categoria.especial === "NENHUMA") continue;
      // Parte da parcela que cabe a este rateio (proporcional).
      const valor = (p.valorCentavos * r.valorCentavos) / p.titulo.valorCentavos;
      linhas.push({ empresa: p.titulo.cliente.pessoa.nome, clienteId: p.titulo.clienteId, tipo: r.categoria.especial as "PRO_LABORE", data: p.dataBaixa!, descricao: p.titulo.descricao, valor });
    }
  }
  return linhas;
}

// ---------------------------------------------------------------------------
// Simulação
// ---------------------------------------------------------------------------

export interface EntradaSimulacao {
  rendimentosTributaveis: string;
  previdenciaOficial: string;
  dependentes: string;
  despesasMedicas: string;
  instrucao: string; // valores separados por ";" (um por pessoa)
  pgbl: string;
  pensaoAlimenticia: string;
  impostoRetido: string;
  rendimentosTotais: string;
}

export async function simular(tx: Tx, autor: Autor, declaracaoId: string, e: EntradaSimulacao) {
  const d = await declaracaoVisivel(tx, autor, declaracaoId);
  if (!d) throw new ErroDeNegocio("Declaração não encontrada.");
  const tabela = await tabelaDoAno(tx, autor.escritorioId, d.anoCalendario);
  if (!tabela) throw new ErroDeNegocio(`Não há tabela do IRPF para ${d.anoCalendario}. O administrador cadastra em IRPF › Tabelas.`);
  const v = (s: string, nome: string) => {
    try {
      return s.trim() ? reaisParaCentavos(s) : 0n;
    } catch {
      throw new ErroDeNegocio(`${nome}: valor inválido.`);
    }
  };
  const dependentes = Number(e.dependentes || 0);
  if (!Number.isInteger(dependentes) || dependentes < 0 || dependentes > 30) throw new ErroDeNegocio("Número de dependentes inválido.");
  const r = calcularAnual({
    rendimentosTributaveis: v(e.rendimentosTributaveis, "Rendimentos tributáveis"), previdenciaOficial: v(e.previdenciaOficial, "Previdência oficial"),
    dependentes, despesasMedicas: v(e.despesasMedicas, "Despesas médicas"), instrucao: e.instrucao.split(";").filter((x) => x.trim()).map((x) => v(x, "Instrução")),
    pgbl: v(e.pgbl, "PGBL"), pensaoAlimenticia: v(e.pensaoAlimenticia, "Pensão"), impostoRetido: v(e.impostoRetido, "Imposto retido"),
    rendimentosTotais: e.rendimentosTotais.trim() ? v(e.rendimentosTotais, "Rendimentos totais") : undefined,
  }, tabela.parametros as unknown as ParametrosIRPF);
  if (!tabela.confirmada) r.avisos.unshift(`A tabela de ${d.anoCalendario} ainda não foi confirmada nas fontes oficiais: use o resultado só como estimativa.`);
  const guardado = JSON.parse(JSON.stringify({ entrada: e, resultado: r, calculadoEm: new Date().toISOString(), tabelaConfirmada: tabela.confirmada }, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
  const melhor = r.melhor === "COMPLETO" ? r.completo : r.simplificado;
  await tx.declaracaoIRPF.update({ where: { id: d.id }, data: { simulacao: guardado, modelo: r.melhor, resultadoCentavos: melhor.saldo } });
  await evento(tx, autor, d.id, `Simulação: melhor modelo ${r.melhor === "COMPLETO" ? "completo" : "simplificado"}, ${melhor.saldo >= 0n ? "a pagar" : "a restituir"} ${formatarReais(melhor.saldo < 0n ? -melhor.saldo : melhor.saldo)}`);
  return r;
}
