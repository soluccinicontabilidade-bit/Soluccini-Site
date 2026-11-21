-- Fases 1 e 2: base e contabilidade
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateEnum
CREATE TYPE "PerfilUsuario" AS ENUM ('ADMINISTRADOR', 'CONTADOR', 'ANALISTA_BPO', 'ANALISTA_IRPF', 'CLIENTE_LEITOR', 'CLIENTE_APROVADOR');

-- CreateEnum
CREATE TYPE "TipoPessoa" AS ENUM ('PF', 'PJ');

-- CreateEnum
CREATE TYPE "RegimeTributario" AS ENUM ('MEI', 'SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL');

-- CreateEnum
CREATE TYPE "TipoVinculo" AS ENUM ('SOCIO', 'SOCIO_ADMINISTRADOR', 'ADMINISTRADOR', 'TITULAR');

-- CreateEnum
CREATE TYPE "SituacaoCliente" AS ENUM ('EM_ENTRADA', 'ATIVO', 'SUSPENSO', 'ENCERRADO');

-- CreateEnum
CREATE TYPE "RegimeContabil" AS ENUM ('COMPETENCIA', 'CAIXA');

-- CreateEnum
CREATE TYPE "ServicoContratado" AS ENUM ('CONTABIL', 'BPO_FINANCEIRO', 'IRPF');

-- CreateEnum
CREATE TYPE "TipoImportacao" AS ENUM ('CLIENTES', 'PLANO_DE_CONTAS', 'SALDOS_INICIAIS');

-- CreateEnum
CREATE TYPE "SituacaoImportacao" AS ENUM ('RECEBIDA', 'VALIDANDO', 'COM_ERROS', 'PRONTA', 'APLICADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "GrupoConta" AS ENUM ('ATIVO', 'PASSIVO', 'PATRIMONIO_LIQUIDO', 'RECEITA', 'CUSTO', 'DESPESA', 'APURACAO');

-- CreateEnum
CREATE TYPE "NaturezaConta" AS ENUM ('DEVEDORA', 'CREDORA');

-- CreateEnum
CREATE TYPE "SituacaoPeriodo" AS ENUM ('ABERTO', 'EM_CONFERENCIA', 'FECHADO');

-- CreateEnum
CREATE TYPE "OrigemLancamento" AS ENUM ('MANUAL', 'AJUSTE', 'PROVISAO', 'SALDO_INICIAL', 'IMPORTACAO', 'FINANCEIRO', 'ENCERRAMENTO', 'ESTORNO');

-- CreateEnum
CREATE TYPE "TipoPartida" AS ENUM ('DEBITO', 'CREDITO');

-- CreateTable
CREATE TABLE "escritorio" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj_cifrado" BYTEA NOT NULL,
    "cnpj_hash" TEXT NOT NULL,
    "cnpj_final" VARCHAR(4) NOT NULL,
    "crc_responsavel" TEXT,
    "fuso_horario" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "escritorio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "perfil" "PerfilUsuario" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "totp_segredo_cifrado" BYTEA,
    "totp_ativado_em" TIMESTAMPTZ(3),
    "tentativas_falhas" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_ate" TIMESTAMPTZ(3),
    "ultimo_acesso_em" TIMESTAMPTZ(3),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessao" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ip" INET,
    "user_agent" TEXT,
    "dois_fatores_ok" BOOLEAN NOT NULL DEFAULT false,
    "expira_em" TIMESTAMPTZ(3) NOT NULL,
    "revogada_em" TIMESTAMPTZ(3),
    "criada_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "codigo_recuperacao" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "usado_em" TIMESTAMPTZ(3),

    CONSTRAINT "codigo_recuperacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carteira" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "responsavel_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carteira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carteira_cliente" (
    "carteira_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,

    CONSTRAINT "carteira_cliente_pkey" PRIMARY KEY ("carteira_id","cliente_id")
);

-- CreateTable
CREATE TABLE "acesso_cliente" (
    "usuario_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,

    CONSTRAINT "acesso_cliente_pkey" PRIMARY KEY ("usuario_id","cliente_id")
);

-- CreateTable
CREATE TABLE "pessoa" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "tipo" "TipoPessoa" NOT NULL,
    "documento_cifrado" BYTEA NOT NULL,
    "documento_hash" TEXT NOT NULL,
    "documento_final" VARCHAR(4) NOT NULL,
    "nome" TEXT NOT NULL,
    "nome_fantasia" TEXT,
    "data_nascimento" DATE,
    "data_abertura" DATE,
    "regime_tributario" "RegimeTributario",
    "cnae_principal" VARCHAR(9),
    "cnaes_secundarios" TEXT[],
    "inscricao_estadual" TEXT,
    "inscricao_municipal" TEXT,
    "email" CITEXT,
    "telefone" TEXT,
    "cep" VARCHAR(8),
    "logradouro" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "municipio" TEXT,
    "uf" CHAR(2),
    "codigo_ibge" VARCHAR(7),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
    "excluido_em" TIMESTAMPTZ(3),

    CONSTRAINT "pessoa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contato" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "pessoa_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "funcao" TEXT,
    "email" CITEXT,
    "telefone" TEXT,
    "principal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "contato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vinculo_societario" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "socio_id" UUID NOT NULL,
    "tipo" "TipoVinculo" NOT NULL,
    "participacao_bp" INTEGER NOT NULL,
    "inicio" DATE NOT NULL,
    "fim" DATE,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vinculo_societario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliente" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "pessoa_id" UUID NOT NULL,
    "codigo" INTEGER NOT NULL DEFAULT 0,
    "situacao" "SituacaoCliente" NOT NULL DEFAULT 'EM_ENTRADA',
    "regime_contabil" "RegimeContabil" NOT NULL DEFAULT 'COMPETENCIA',
    "inicio_servico" DATE NOT NULL,
    "fim_servico" DATE,
    "observacoes" TEXT,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
    "excluido_em" TIMESTAMPTZ(3),

    CONSTRAINT "cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etiqueta" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "cor" VARCHAR(7) NOT NULL,

    CONSTRAINT "etiqueta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliente_etiqueta" (
    "cliente_id" UUID NOT NULL,
    "etiqueta_id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,

    CONSTRAINT "cliente_etiqueta_pkey" PRIMARY KEY ("cliente_id","etiqueta_id")
);

-- CreateTable
CREATE TABLE "item_checklist_entrada" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "ordem" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "concluido_em" TIMESTAMPTZ(3),
    "concluido_por_id" UUID,
    "observacao" TEXT,

    CONSTRAINT "item_checklist_entrada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_cliente" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "resumo" TEXT NOT NULL,
    "dados" JSONB,
    "usuario_id" UUID,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evento_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contrato" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "servicos" "ServicoContratado"[],
    "inicio" DATE NOT NULL,
    "fim" DATE,
    "dia_vencimento" INTEGER NOT NULL,
    "observacoes" TEXT,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excluido_em" TIMESTAMPTZ(3),

    CONSTRAINT "contrato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valor_honorario" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "contrato_id" UUID NOT NULL,
    "valor_centavos" BIGINT NOT NULL,
    "vigencia_inicio" DATE NOT NULL,
    "motivo" TEXT NOT NULL,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "valor_honorario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categoria_documento" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "tem_validade" BOOLEAN NOT NULL DEFAULT false,
    "aviso_dias_antes" INTEGER,

    CONSTRAINT "categoria_documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documento" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "categoria_id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "competencia" DATE,
    "valido_ate" DATE,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excluido_em" TIMESTAMPTZ(3),

    CONSTRAINT "documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "versao_documento" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "versao" INTEGER NOT NULL,
    "chave_arquivo" TEXT NOT NULL,
    "nome_original" TEXT NOT NULL,
    "tipo_mime" TEXT NOT NULL,
    "tamanho_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "enviado_por_id" UUID NOT NULL,
    "enviado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "versao_documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "importacao" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID,
    "tipo" "TipoImportacao" NOT NULL,
    "situacao" "SituacaoImportacao" NOT NULL DEFAULT 'RECEBIDA',
    "chave_arquivo" TEXT NOT NULL,
    "nome_original" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "mapeamento" JSONB,
    "resumo" JSONB,
    "erros" JSONB,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aplicada_em" TIMESTAMPTZ(3),

    CONSTRAINT "importacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plano_de_contas" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID,
    "nome" TEXT NOT NULL,
    "copiado_de_id" UUID,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plano_de_contas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conta_contabil" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "plano_id" UUID NOT NULL,
    "pai_id" UUID,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "grupo" "GrupoConta" NOT NULL,
    "natureza" "NaturezaConta" NOT NULL,
    "nivel" INTEGER NOT NULL,
    "analitica" BOOLEAN NOT NULL,
    "codigo_referencial" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conta_contabil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "periodo_contabil" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "competencia" DATE NOT NULL,
    "situacao" "SituacaoPeriodo" NOT NULL DEFAULT 'ABERTO',
    "fechado_em" TIMESTAMPTZ(3),
    "fechado_por_id" UUID,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "periodo_contabil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transicao_periodo" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "periodo_id" UUID NOT NULL,
    "de" "SituacaoPeriodo" NOT NULL,
    "para" "SituacaoPeriodo" NOT NULL,
    "justificativa" TEXT,
    "usuario_id" UUID NOT NULL,
    "ocorrida_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transicao_periodo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "justificativa_fechamento" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "periodo_id" UUID NOT NULL,
    "conta_bancaria_id" UUID,
    "descricao_conta" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "usuario_id" UUID NOT NULL,
    "criada_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "justificativa_fechamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lancamento_contabil" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "periodo_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL DEFAULT 0,
    "data" DATE NOT NULL,
    "historico" TEXT NOT NULL,
    "origem" "OrigemLancamento" NOT NULL,
    "justificativa" TEXT,
    "importacao_id" UUID,
    "estorna_id" UUID,
    "chave_origem" TEXT,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excluido_em" TIMESTAMPTZ(3),

    CONSTRAINT "lancamento_contabil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partida" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "lancamento_id" UUID NOT NULL,
    "conta_id" UUID NOT NULL,
    "tipo" "TipoPartida" NOT NULL,
    "valor_centavos" BIGINT NOT NULL,
    "historico_complementar" TEXT,
    "ordem" INTEGER NOT NULL,

    CONSTRAINT "partida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_auditoria" (
    "id" BIGSERIAL NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "tabela" TEXT NOT NULL,
    "registro_id" TEXT NOT NULL,
    "operacao" VARCHAR(6) NOT NULL,
    "antes" JSONB,
    "depois" JSONB,
    "usuario_id" UUID,
    "ip" INET,
    "origem" TEXT,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "escritorio_cnpj_hash_key" ON "escritorio"("cnpj_hash");

-- CreateIndex
CREATE INDEX "usuario_escritorio_id_perfil_idx" ON "usuario"("escritorio_id", "perfil");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_escritorio_id_email_key" ON "usuario"("escritorio_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "sessao_token_hash_key" ON "sessao"("token_hash");

-- CreateIndex
CREATE INDEX "sessao_usuario_id_idx" ON "sessao"("usuario_id");

-- CreateIndex
CREATE INDEX "sessao_expira_em_idx" ON "sessao"("expira_em");

-- CreateIndex
CREATE INDEX "codigo_recuperacao_usuario_id_idx" ON "codigo_recuperacao"("usuario_id");

-- CreateIndex
CREATE INDEX "carteira_responsavel_id_idx" ON "carteira"("responsavel_id");

-- CreateIndex
CREATE UNIQUE INDEX "carteira_escritorio_id_nome_key" ON "carteira"("escritorio_id", "nome");

-- CreateIndex
CREATE INDEX "carteira_cliente_cliente_id_idx" ON "carteira_cliente"("cliente_id");

-- CreateIndex
CREATE INDEX "acesso_cliente_cliente_id_idx" ON "acesso_cliente"("cliente_id");

-- CreateIndex
CREATE INDEX "pessoa_escritorio_id_tipo_idx" ON "pessoa"("escritorio_id", "tipo");

-- CreateIndex
CREATE INDEX "pessoa_escritorio_id_nome_idx" ON "pessoa"("escritorio_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "pessoa_escritorio_id_documento_hash_key" ON "pessoa"("escritorio_id", "documento_hash");

-- CreateIndex
CREATE INDEX "contato_pessoa_id_idx" ON "contato"("pessoa_id");

-- CreateIndex
CREATE INDEX "vinculo_societario_empresa_id_idx" ON "vinculo_societario"("empresa_id");

-- CreateIndex
CREATE INDEX "vinculo_societario_socio_id_idx" ON "vinculo_societario"("socio_id");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_pessoa_id_key" ON "cliente"("pessoa_id");

-- CreateIndex
CREATE INDEX "cliente_escritorio_id_situacao_idx" ON "cliente"("escritorio_id", "situacao");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_escritorio_id_codigo_key" ON "cliente"("escritorio_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "etiqueta_escritorio_id_nome_key" ON "etiqueta"("escritorio_id", "nome");

-- CreateIndex
CREATE INDEX "cliente_etiqueta_etiqueta_id_idx" ON "cliente_etiqueta"("etiqueta_id");

-- CreateIndex
CREATE INDEX "item_checklist_entrada_cliente_id_ordem_idx" ON "item_checklist_entrada"("cliente_id", "ordem");

-- CreateIndex
CREATE INDEX "evento_cliente_cliente_id_ocorrido_em_idx" ON "evento_cliente"("cliente_id", "ocorrido_em" DESC);

-- CreateIndex
CREATE INDEX "contrato_cliente_id_idx" ON "contrato"("cliente_id");

-- CreateIndex
CREATE UNIQUE INDEX "valor_honorario_contrato_id_vigencia_inicio_key" ON "valor_honorario"("contrato_id", "vigencia_inicio");

-- CreateIndex
CREATE UNIQUE INDEX "categoria_documento_escritorio_id_nome_key" ON "categoria_documento"("escritorio_id", "nome");

-- CreateIndex
CREATE INDEX "documento_cliente_id_competencia_idx" ON "documento"("cliente_id", "competencia");

-- CreateIndex
CREATE INDEX "documento_escritorio_id_valido_ate_idx" ON "documento"("escritorio_id", "valido_ate");

-- CreateIndex
CREATE INDEX "versao_documento_escritorio_id_sha256_idx" ON "versao_documento"("escritorio_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "versao_documento_documento_id_versao_key" ON "versao_documento"("documento_id", "versao");

-- CreateIndex
CREATE INDEX "importacao_escritorio_id_tipo_sha256_idx" ON "importacao"("escritorio_id", "tipo", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "plano_de_contas_cliente_id_key" ON "plano_de_contas"("cliente_id");

-- CreateIndex
CREATE INDEX "conta_contabil_pai_id_idx" ON "conta_contabil"("pai_id");

-- CreateIndex
CREATE UNIQUE INDEX "conta_contabil_plano_id_codigo_key" ON "conta_contabil"("plano_id", "codigo");

-- CreateIndex
CREATE INDEX "periodo_contabil_escritorio_id_situacao_idx" ON "periodo_contabil"("escritorio_id", "situacao");

-- CreateIndex
CREATE UNIQUE INDEX "periodo_contabil_cliente_id_competencia_key" ON "periodo_contabil"("cliente_id", "competencia");

-- CreateIndex
CREATE INDEX "transicao_periodo_periodo_id_ocorrida_em_idx" ON "transicao_periodo"("periodo_id", "ocorrida_em");

-- CreateIndex
CREATE INDEX "justificativa_fechamento_periodo_id_idx" ON "justificativa_fechamento"("periodo_id");

-- CreateIndex
CREATE UNIQUE INDEX "lancamento_contabil_estorna_id_key" ON "lancamento_contabil"("estorna_id");

-- CreateIndex
CREATE INDEX "lancamento_contabil_cliente_id_data_idx" ON "lancamento_contabil"("cliente_id", "data");

-- CreateIndex
CREATE INDEX "lancamento_contabil_periodo_id_idx" ON "lancamento_contabil"("periodo_id");

-- CreateIndex
CREATE UNIQUE INDEX "lancamento_contabil_cliente_id_numero_key" ON "lancamento_contabil"("cliente_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "lancamento_contabil_cliente_id_chave_origem_key" ON "lancamento_contabil"("cliente_id", "chave_origem");

-- CreateIndex
CREATE INDEX "partida_lancamento_id_idx" ON "partida"("lancamento_id");

-- CreateIndex
CREATE INDEX "partida_conta_id_idx" ON "partida"("conta_id");

-- CreateIndex
CREATE INDEX "registro_auditoria_escritorio_id_tabela_registro_id_idx" ON "registro_auditoria"("escritorio_id", "tabela", "registro_id");

-- CreateIndex
CREATE INDEX "registro_auditoria_escritorio_id_ocorrido_em_idx" ON "registro_auditoria"("escritorio_id", "ocorrido_em" DESC);

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_escritorio_id_fkey" FOREIGN KEY ("escritorio_id") REFERENCES "escritorio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codigo_recuperacao" ADD CONSTRAINT "codigo_recuperacao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carteira" ADD CONSTRAINT "carteira_escritorio_id_fkey" FOREIGN KEY ("escritorio_id") REFERENCES "escritorio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carteira" ADD CONSTRAINT "carteira_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carteira_cliente" ADD CONSTRAINT "carteira_cliente_carteira_id_fkey" FOREIGN KEY ("carteira_id") REFERENCES "carteira"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carteira_cliente" ADD CONSTRAINT "carteira_cliente_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acesso_cliente" ADD CONSTRAINT "acesso_cliente_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acesso_cliente" ADD CONSTRAINT "acesso_cliente_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pessoa" ADD CONSTRAINT "pessoa_escritorio_id_fkey" FOREIGN KEY ("escritorio_id") REFERENCES "escritorio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contato" ADD CONSTRAINT "contato_pessoa_id_fkey" FOREIGN KEY ("pessoa_id") REFERENCES "pessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo_societario" ADD CONSTRAINT "vinculo_societario_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "pessoa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo_societario" ADD CONSTRAINT "vinculo_societario_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "pessoa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_escritorio_id_fkey" FOREIGN KEY ("escritorio_id") REFERENCES "escritorio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_pessoa_id_fkey" FOREIGN KEY ("pessoa_id") REFERENCES "pessoa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etiqueta" ADD CONSTRAINT "etiqueta_escritorio_id_fkey" FOREIGN KEY ("escritorio_id") REFERENCES "escritorio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente_etiqueta" ADD CONSTRAINT "cliente_etiqueta_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente_etiqueta" ADD CONSTRAINT "cliente_etiqueta_etiqueta_id_fkey" FOREIGN KEY ("etiqueta_id") REFERENCES "etiqueta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_checklist_entrada" ADD CONSTRAINT "item_checklist_entrada_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_cliente" ADD CONSTRAINT "evento_cliente_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contrato" ADD CONSTRAINT "contrato_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valor_honorario" ADD CONSTRAINT "valor_honorario_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categoria_documento" ADD CONSTRAINT "categoria_documento_escritorio_id_fkey" FOREIGN KEY ("escritorio_id") REFERENCES "escritorio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento" ADD CONSTRAINT "documento_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento" ADD CONSTRAINT "documento_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categoria_documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versao_documento" ADD CONSTRAINT "versao_documento_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "importacao" ADD CONSTRAINT "importacao_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plano_de_contas" ADD CONSTRAINT "plano_de_contas_escritorio_id_fkey" FOREIGN KEY ("escritorio_id") REFERENCES "escritorio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plano_de_contas" ADD CONSTRAINT "plano_de_contas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plano_de_contas" ADD CONSTRAINT "plano_de_contas_copiado_de_id_fkey" FOREIGN KEY ("copiado_de_id") REFERENCES "plano_de_contas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conta_contabil" ADD CONSTRAINT "conta_contabil_plano_id_fkey" FOREIGN KEY ("plano_id") REFERENCES "plano_de_contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conta_contabil" ADD CONSTRAINT "conta_contabil_pai_id_fkey" FOREIGN KEY ("pai_id") REFERENCES "conta_contabil"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "periodo_contabil" ADD CONSTRAINT "periodo_contabil_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transicao_periodo" ADD CONSTRAINT "transicao_periodo_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "periodo_contabil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "justificativa_fechamento" ADD CONSTRAINT "justificativa_fechamento_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "periodo_contabil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento_contabil" ADD CONSTRAINT "lancamento_contabil_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento_contabil" ADD CONSTRAINT "lancamento_contabil_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "periodo_contabil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento_contabil" ADD CONSTRAINT "lancamento_contabil_estorna_id_fkey" FOREIGN KEY ("estorna_id") REFERENCES "lancamento_contabil"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partida" ADD CONSTRAINT "partida_lancamento_id_fkey" FOREIGN KEY ("lancamento_id") REFERENCES "lancamento_contabil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partida" ADD CONSTRAINT "partida_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "conta_contabil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ====== Regras (prisma/sql/regras.sql) ======
-- =============================================================================
-- Regras do banco que o Prisma não expressa. Entram na primeira migração,
-- depois do DDL gerado pelo Prisma.
-- Variáveis de sessão que a aplicação define em toda transação (SET LOCAL):
--   app.escritorio_id  uuid do escritório do usuário logado
--   app.usuario_id     uuid do usuário (vazio em rotinas de sistema)
--   app.perfil         PerfilUsuario do usuário
--   app.ip             IP de origem
--   app.origem         "web", "fila:importacao", "seed", ...
-- =============================================================================

-- Auxiliares --------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_setting(nome text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting(nome, true), '')
$$;

-- -----------------------------------------------------------------------------
-- 1. CHECKs simples
-- -----------------------------------------------------------------------------

ALTER TABLE partida
  ADD CONSTRAINT partida_valor_positivo CHECK (valor_centavos > 0);

ALTER TABLE vinculo_societario
  ADD CONSTRAINT vinculo_participacao_faixa CHECK (participacao_bp BETWEEN 0 AND 10000),
  ADD CONSTRAINT vinculo_datas CHECK (fim IS NULL OR fim >= inicio),
  ADD CONSTRAINT vinculo_nao_proprio CHECK (empresa_id <> socio_id);

ALTER TABLE contrato
  ADD CONSTRAINT contrato_dia_vencimento CHECK (dia_vencimento BETWEEN 1 AND 28),
  ADD CONSTRAINT contrato_datas CHECK (fim IS NULL OR fim >= inicio);

ALTER TABLE valor_honorario
  ADD CONSTRAINT valor_honorario_nao_negativo CHECK (valor_centavos >= 0);

ALTER TABLE periodo_contabil
  ADD CONSTRAINT periodo_competencia_dia_1 CHECK (EXTRACT(DAY FROM competencia) = 1);

ALTER TABLE documento
  ADD CONSTRAINT documento_competencia_dia_1
  CHECK (competencia IS NULL OR EXTRACT(DAY FROM competencia) = 1);

ALTER TABLE lancamento_contabil
  ADD CONSTRAINT lancamento_justificativa_obrigatoria
  CHECK (origem NOT IN ('AJUSTE','PROVISAO','ESTORNO')
         OR length(btrim(coalesce(justificativa, ''))) > 0),
  ADD CONSTRAINT lancamento_estorno_coerente
  CHECK ((origem = 'ESTORNO') = (estorna_id IS NOT NULL));

ALTER TABLE pessoa
  ADD CONSTRAINT pessoa_regime_so_pj CHECK (tipo = 'PJ' OR regime_tributario IS NULL);

ALTER TABLE transicao_periodo
  ADD CONSTRAINT transicao_reabertura_justificada
  CHECK (de <> 'FECHADO' OR length(btrim(coalesce(justificativa, ''))) > 0);

-- -----------------------------------------------------------------------------
-- 2. Números sequenciais sem buracos
-- -----------------------------------------------------------------------------
-- A linha "dona" da sequência é travada (FOR UPDATE), então duas inserções
-- concorrentes esperam uma pela outra em vez de pegar o mesmo número.

CREATE OR REPLACE FUNCTION trg_cliente_codigo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM escritorio WHERE id = NEW.escritorio_id FOR UPDATE;
  SELECT coalesce(max(codigo), 0) + 1 INTO NEW.codigo
    FROM cliente WHERE escritorio_id = NEW.escritorio_id;
  RETURN NEW;
END $$;

CREATE TRIGGER cliente_codigo BEFORE INSERT ON cliente
  FOR EACH ROW EXECUTE FUNCTION trg_cliente_codigo();

CREATE OR REPLACE FUNCTION trg_lancamento_numero() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM cliente WHERE id = NEW.cliente_id FOR UPDATE;
  SELECT coalesce(max(numero), 0) + 1 INTO NEW.numero
    FROM lancamento_contabil WHERE cliente_id = NEW.cliente_id;
  RETURN NEW;
END $$;

CREATE TRIGGER lancamento_numero BEFORE INSERT ON lancamento_contabil
  FOR EACH ROW EXECUTE FUNCTION trg_lancamento_numero();

-- -----------------------------------------------------------------------------
-- 3. Coerência entre tabelas (mesmo escritório, mesmo cliente, mesmo plano)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_lancamento_coerencia() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM periodo_contabil WHERE id = NEW.periodo_id;
  IF p.cliente_id <> NEW.cliente_id OR p.escritorio_id <> NEW.escritorio_id THEN
    RAISE EXCEPTION 'Lançamento e período pertencem a clientes diferentes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF date_trunc('month', NEW.data)::date <> p.competencia THEN
    RAISE EXCEPTION 'A data % está fora da competência %', NEW.data, p.competencia
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER lancamento_coerencia BEFORE INSERT OR UPDATE ON lancamento_contabil
  FOR EACH ROW EXECUTE FUNCTION trg_lancamento_coerencia();

-- Partida só em conta ANALÍTICA, ATIVA, do plano DO CLIENTE do lançamento.
CREATE OR REPLACE FUNCTION trg_partida_conta_valida() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ok boolean;
BEGIN
  SELECT c.analitica AND c.ativa AND pl.cliente_id = l.cliente_id
         AND l.escritorio_id = NEW.escritorio_id
    INTO ok
    FROM lancamento_contabil l
    JOIN conta_contabil c ON c.id = NEW.conta_id
    JOIN plano_de_contas pl ON pl.id = c.plano_id
   WHERE l.id = NEW.lancamento_id;
  IF NOT coalesce(ok, false) THEN
    RAISE EXCEPTION 'A conta % não é analítica e ativa no plano deste cliente', NEW.conta_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER partida_conta_valida BEFORE INSERT OR UPDATE ON partida
  FOR EACH ROW EXECUTE FUNCTION trg_partida_conta_valida();

-- -----------------------------------------------------------------------------
-- 4. Regra inviolável: débitos = créditos em cada lançamento
-- -----------------------------------------------------------------------------
-- Trigger de restrição ADIADO: roda no COMMIT, depois que todas as partidas
-- da transação foram gravadas. Lançamento excluído logicamente continua
-- precisando fechar (ele permanece no histórico).

CREATE OR REPLACE FUNCTION verificar_lancamento_fecha(p_lancamento uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE d bigint; c bigint; n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lancamento_contabil WHERE id = p_lancamento) THEN
    RETURN; -- lançamento removido junto (só acontece em rollback de teste)
  END IF;
  SELECT coalesce(sum(valor_centavos) FILTER (WHERE tipo = 'DEBITO'), 0),
         coalesce(sum(valor_centavos) FILTER (WHERE tipo = 'CREDITO'), 0),
         count(*)
    INTO d, c, n
    FROM partida WHERE lancamento_id = p_lancamento;
  IF n < 2 OR d <> c OR d = 0 THEN
    RAISE EXCEPTION 'Lançamento % não fecha: débitos % e créditos % centavos em % partidas',
      p_lancamento, d, c, n USING ERRCODE = 'check_violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION trg_lancamento_fecha() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'lancamento_contabil' THEN
    PERFORM verificar_lancamento_fecha(NEW.id);
  ELSE
    IF TG_OP IN ('UPDATE','DELETE') THEN PERFORM verificar_lancamento_fecha(OLD.lancamento_id); END IF;
    IF TG_OP IN ('INSERT','UPDATE') THEN PERFORM verificar_lancamento_fecha(NEW.lancamento_id); END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER lancamento_fecha_no_commit
  AFTER INSERT OR UPDATE ON lancamento_contabil
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_lancamento_fecha();

CREATE CONSTRAINT TRIGGER partida_fecha_no_commit
  AFTER INSERT OR UPDATE OR DELETE ON partida
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_lancamento_fecha();

-- -----------------------------------------------------------------------------
-- 5. Período em conferência ou fechado não aceita alteração
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION periodo_situacao(p_periodo uuid) RETURNS "SituacaoPeriodo"
LANGUAGE sql STABLE AS $$ SELECT situacao FROM periodo_contabil WHERE id = p_periodo $$;

-- Período EM_CONFERENCIA ou FECHADO não aceita incluir, alterar ou excluir
-- lançamentos e partidas. Para corrigir algo em conferência, o período volta
-- para ABERTO (com registro em transicao_periodo).
CREATE OR REPLACE FUNCTION periodo_travado(p_periodo uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT periodo_situacao(p_periodo) IN ('EM_CONFERENCIA','FECHADO')
$$;

CREATE OR REPLACE FUNCTION trg_bloqueio_periodo_fechado() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE pid uuid;
BEGIN
  IF TG_TABLE_NAME = 'lancamento_contabil' THEN
    IF TG_OP <> 'INSERT' AND periodo_travado(OLD.periodo_id) THEN
      RAISE EXCEPTION 'Período em conferência ou fechado: o lançamento % não pode ser alterado', OLD.numero
        USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP <> 'DELETE' AND periodo_travado(NEW.periodo_id) THEN
      RAISE EXCEPTION 'Período em conferência ou fechado: não aceita novos lançamentos'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE -- partida
    IF TG_OP <> 'INSERT' THEN
      SELECT periodo_id INTO pid FROM lancamento_contabil WHERE id = OLD.lancamento_id;
      IF periodo_travado(pid) THEN
        RAISE EXCEPTION 'Período em conferência ou fechado: partidas não podem ser alteradas'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT periodo_id INTO pid FROM lancamento_contabil WHERE id = NEW.lancamento_id;
      IF periodo_travado(pid) THEN
        RAISE EXCEPTION 'Período em conferência ou fechado: partidas não podem ser incluídas'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

CREATE TRIGGER lancamento_bloqueio_fechado
  BEFORE INSERT OR UPDATE OR DELETE ON lancamento_contabil
  FOR EACH ROW EXECUTE FUNCTION trg_bloqueio_periodo_fechado();

CREATE TRIGGER partida_bloqueio_fechado
  BEFORE INSERT OR UPDATE OR DELETE ON partida
  FOR EACH ROW EXECUTE FUNCTION trg_bloqueio_periodo_fechado();

-- Mudança de situação do período: exige uma linha em transicao_periodo gravada
-- na MESMA transação (ocorrida_em = now(), que é o início da transação).
-- Sair de FECHADO exige perfil CONTADOR e justificativa
-- (garantida pelo CHECK em transicao_periodo).
CREATE OR REPLACE FUNCTION trg_periodo_transicao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.situacao IS NOT DISTINCT FROM OLD.situacao THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM transicao_periodo t
     WHERE t.periodo_id = NEW.id AND t.de = OLD.situacao AND t.para = NEW.situacao
       AND t.ocorrida_em = now()::timestamptz(3)
  ) THEN
    RAISE EXCEPTION 'Mudança de % para % sem registro em transicao_periodo', OLD.situacao, NEW.situacao
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.situacao = 'FECHADO'
     AND coalesce(app_setting('app.perfil'), '') <> 'CONTADOR' THEN
    RAISE EXCEPTION 'Só o contador responsável pode reabrir um período fechado'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.situacao = 'FECHADO' THEN
    NEW.fechado_em := now();
    NEW.fechado_por_id := app_setting('app.usuario_id')::uuid;
  ELSIF OLD.situacao = 'FECHADO' THEN
    NEW.fechado_em := NULL;
    NEW.fechado_por_id := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER periodo_transicao BEFORE UPDATE OF situacao ON periodo_contabil
  FOR EACH ROW EXECUTE FUNCTION trg_periodo_transicao();

-- O horário da transição é sempre o do banco, nunca o enviado pela aplicação.
CREATE OR REPLACE FUNCTION trg_transicao_horario() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.ocorrida_em := now();
  RETURN NEW;
END $$;

CREATE TRIGGER transicao_horario BEFORE INSERT ON transicao_periodo
  FOR EACH ROW EXECUTE FUNCTION trg_transicao_horario();

-- -----------------------------------------------------------------------------
-- 6. Trilha de auditoria imutável
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_auditoria_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'registro_auditoria é somente inclusão' USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER auditoria_sem_update BEFORE UPDATE OR DELETE ON registro_auditoria
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria_imutavel();
CREATE TRIGGER auditoria_sem_truncate BEFORE TRUNCATE ON registro_auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION trg_auditoria_imutavel();

-- Campos cifrados e de segredo nunca vão para a auditoria em claro.
CREATE OR REPLACE FUNCTION auditoria_limpar(j jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT j - ARRAY['senha_hash','totp_segredo_cifrado','token_hash','codigo_hash',
                   'documento_cifrado','cnpj_cifrado']
$$;

CREATE OR REPLACE FUNCTION trg_auditar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE linha jsonb := to_jsonb(coalesce(NEW, OLD));
BEGIN
  INSERT INTO registro_auditoria
    (escritorio_id, tabela, registro_id, operacao, antes, depois, usuario_id, ip, origem)
  VALUES (
    (linha->>'escritorio_id')::uuid,
    TG_TABLE_NAME,
    coalesce(linha->>'id', linha::text),
    TG_OP,
    CASE WHEN TG_OP <> 'INSERT' THEN auditoria_limpar(to_jsonb(OLD)) END,
    CASE WHEN TG_OP <> 'DELETE' THEN auditoria_limpar(to_jsonb(NEW)) END,
    app_setting('app.usuario_id')::uuid,
    app_setting('app.ip')::inet,
    app_setting('app.origem')
  );
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'usuario','carteira','carteira_cliente','acesso_cliente','pessoa','vinculo_societario',
    'cliente','contrato','valor_honorario','documento','versao_documento','importacao',
    'plano_de_contas','conta_contabil','periodo_contabil','transicao_periodo',
    'justificativa_fechamento','lancamento_contabil','partida'
  ] LOOP
    EXECUTE format('CREATE TRIGGER auditar AFTER INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION trg_auditar()', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 7. Isolamento entre escritórios (Row Level Security)
-- -----------------------------------------------------------------------------
-- A aplicação conecta com o papel "app" (sem BYPASSRLS, não dono das tabelas)
-- e faz SET LOCAL app.escritorio_id no início de cada transação. Sem essa
-- variável, nenhuma linha aparece. Migrações rodam com o papel dono.
-- A restrição por carteira e por cliente (analista x cliente, cliente x seus
-- dados) fica na camada de aplicação, com testes automáticos.

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
     WHERE c.table_schema = 'public' AND c.column_name = 'escritorio_id'
       AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY isolamento_escritorio ON %I
                     USING (escritorio_id = app_setting('app.escritorio_id')::uuid)
                     WITH CHECK (escritorio_id = app_setting('app.escritorio_id')::uuid)$p$, t);
  END LOOP;
END $$;

ALTER TABLE escritorio ENABLE ROW LEVEL SECURITY;
ALTER TABLE escritorio FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_escritorio ON escritorio
  USING (id = app_setting('app.escritorio_id')::uuid);

-- Papel da aplicação: sem DELETE em dados financeiros/contábeis (exclusão é
-- lógica) e sem UPDATE/DELETE na auditoria.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE app NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app;
REVOKE DELETE ON lancamento_contabil, valor_honorario, transicao_periodo,
                 justificativa_fechamento, versao_documento FROM app;
REVOKE UPDATE, DELETE, TRUNCATE ON registro_auditoria FROM app;
