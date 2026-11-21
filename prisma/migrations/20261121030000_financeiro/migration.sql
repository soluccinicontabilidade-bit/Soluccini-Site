-- CreateEnum
CREATE TYPE "TipoContaBancaria" AS ENUM ('CORRENTE', 'POUPANCA', 'APLICACAO', 'CAIXA', 'CARTAO_CREDITO');

-- CreateEnum
CREATE TYPE "TipoCategoria" AS ENUM ('RECEITA', 'DESPESA');

-- CreateEnum
CREATE TYPE "EspecialCategoria" AS ENUM ('NENHUMA', 'PRO_LABORE', 'DISTRIBUICAO_LUCROS');

-- CreateEnum
CREATE TYPE "TipoTitulo" AS ENUM ('PAGAR', 'RECEBER');

-- CreateEnum
CREATE TYPE "SituacaoParcela" AS ENUM ('ABERTA', 'AGUARDANDO_APROVACAO', 'APROVADA', 'REPROVADA', 'BAIXADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "SituacaoTransacao" AS ENUM ('PENDENTE', 'SUGERIDA', 'CONCILIADA', 'IGNORADA');

-- AlterTable
ALTER TABLE "documento" ADD COLUMN     "titulo_financeiro_id" UUID;

-- CreateTable
CREATE TABLE "conta_bancaria" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoContaBancaria" NOT NULL,
    "banco_codigo" VARCHAR(5),
    "agencia" TEXT,
    "numero" TEXT,
    "conta_contabil_id" UUID,
    "saldo_inicial_centavos" BIGINT NOT NULL DEFAULT 0,
    "data_saldo_inicial" DATE NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conta_bancaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categoria_financeira" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "pai_id" UUID,
    "nome" TEXT NOT NULL,
    "tipo" "TipoCategoria" NOT NULL,
    "especial" "EspecialCategoria" NOT NULL DEFAULT 'NENHUMA',
    "conta_contabil_id" UUID,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "categoria_financeira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "centro_de_custo" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "centro_de_custo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorecido" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "documento_cifrado" BYTEA,
    "documento_hash" TEXT,
    "documento_final" VARCHAR(4),
    "pessoa_id" UUID,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorecido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "titulo_financeiro" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "tipo" "TipoTitulo" NOT NULL,
    "descricao" TEXT NOT NULL,
    "favorecido_id" UUID,
    "documento" TEXT,
    "competencia" DATE NOT NULL,
    "valor_centavos" BIGINT NOT NULL,
    "grupo_recorrencia" UUID,
    "observacao" TEXT,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelado_em" TIMESTAMPTZ(3),
    "motivo_cancelamento" TEXT,

    CONSTRAINT "titulo_financeiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rateio_titulo" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "titulo_id" UUID NOT NULL,
    "categoria_id" UUID NOT NULL,
    "centro_custo_id" UUID,
    "valor_centavos" BIGINT NOT NULL,

    CONSTRAINT "rateio_titulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcela" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "titulo_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "vencimento" DATE NOT NULL,
    "valor_centavos" BIGINT NOT NULL,
    "conta_prevista_id" UUID,
    "situacao" "SituacaoParcela" NOT NULL DEFAULT 'ABERTA',
    "aprovacao_pedida_em" TIMESTAMPTZ(3),
    "aprovado_por_id" UUID,
    "aprovado_em" TIMESTAMPTZ(3),
    "motivo_reprovacao" TEXT,
    "data_baixa" DATE,
    "valor_baixa_centavos" BIGINT,
    "juros_centavos" BIGINT NOT NULL DEFAULT 0,
    "multa_centavos" BIGINT NOT NULL DEFAULT 0,
    "desconto_centavos" BIGINT NOT NULL DEFAULT 0,
    "conta_baixa_id" UUID,
    "baixado_por_id" UUID,
    "baixado_em" TIMESTAMPTZ(3),
    "conciliacao_id" UUID,

    CONSTRAINT "parcela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transferencia" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "origem_id" UUID NOT NULL,
    "destino_id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "valor_centavos" BIGINT NOT NULL,
    "descricao" TEXT NOT NULL,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelada_em" TIMESTAMPTZ(3),
    "conciliacao_origem_id" UUID,
    "conciliacao_destino_id" UUID,

    CONSTRAINT "transferencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extrato_importado" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "conta_bancaria_id" UUID NOT NULL,
    "chave_arquivo" TEXT NOT NULL,
    "nome_original" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "data_inicio" DATE,
    "data_fim" DATE,
    "saldo_final_centavos" BIGINT,
    "data_saldo" DATE,
    "novas" INTEGER NOT NULL,
    "repetidas" INTEGER NOT NULL,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extrato_importado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transacao_bancaria" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "conta_bancaria_id" UUID NOT NULL,
    "extrato_id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "valor_centavos" BIGINT NOT NULL,
    "descricao" TEXT NOT NULL,
    "tipo_ofx" TEXT,
    "fitid" TEXT,
    "impressao_digital" CHAR(64) NOT NULL,
    "situacao" "SituacaoTransacao" NOT NULL DEFAULT 'PENDENTE',
    "justificativa" TEXT,
    "sugestao" JSONB,
    "conciliacao_id" UUID,

    CONSTRAINT "transacao_bancaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conciliacao" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "conta_bancaria_id" UUID NOT NULL,
    "automatica" BOOLEAN NOT NULL DEFAULT false,
    "confianca" INTEGER,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conciliacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regra_conciliacao" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "texto" TEXT NOT NULL,
    "categoria_id" UUID NOT NULL,
    "favorecido_id" UUID,
    "usos" INTEGER NOT NULL DEFAULT 0,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regra_conciliacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fechamento_conciliacao" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "conta_bancaria_id" UUID NOT NULL,
    "competencia" DATE NOT NULL,
    "fechado" BOOLEAN NOT NULL DEFAULT true,
    "saldo_extrato_centavos" BIGINT,
    "saldo_sistema_centavos" BIGINT NOT NULL,
    "fechado_por_id" UUID NOT NULL,
    "fechado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reaberto_por_id" UUID,
    "reaberto_em" TIMESTAMPTZ(3),
    "justificativa_reabertura" TEXT,

    CONSTRAINT "fechamento_conciliacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_financeira" (
    "cliente_id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "tolerancia_dias" INTEGER NOT NULL DEFAULT 3,
    "limite_automatico" INTEGER NOT NULL DEFAULT 95,
    "conta_fornecedores_id" UUID,
    "conta_clientes_id" UUID,
    "conta_juros_pagos_id" UUID,
    "conta_juros_recebidos_id" UUID,
    "conta_descontos_concedidos_id" UUID,
    "conta_descontos_obtidos_id" UUID,

    CONSTRAINT "config_financeira_pkey" PRIMARY KEY ("cliente_id")
);

-- CreateTable
CREATE TABLE "item_checklist_bpo" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "competencia" DATE NOT NULL,
    "ordem" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "concluido_em" TIMESTAMPTZ(3),
    "concluido_por_id" UUID,

    CONSTRAINT "item_checklist_bpo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conta_bancaria_cliente_id_nome_key" ON "conta_bancaria"("cliente_id", "nome");

-- CreateIndex
CREATE INDEX "categoria_financeira_cliente_id_tipo_idx" ON "categoria_financeira"("cliente_id", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "centro_de_custo_cliente_id_nome_key" ON "centro_de_custo"("cliente_id", "nome");

-- CreateIndex
CREATE INDEX "favorecido_cliente_id_nome_idx" ON "favorecido"("cliente_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "favorecido_cliente_id_documento_hash_key" ON "favorecido"("cliente_id", "documento_hash");

-- CreateIndex
CREATE INDEX "titulo_financeiro_cliente_id_competencia_idx" ON "titulo_financeiro"("cliente_id", "competencia");

-- CreateIndex
CREATE INDEX "titulo_financeiro_grupo_recorrencia_idx" ON "titulo_financeiro"("grupo_recorrencia");

-- CreateIndex
CREATE INDEX "rateio_titulo_titulo_id_idx" ON "rateio_titulo"("titulo_id");

-- CreateIndex
CREATE INDEX "rateio_titulo_categoria_id_idx" ON "rateio_titulo"("categoria_id");

-- CreateIndex
CREATE INDEX "parcela_cliente_id_situacao_vencimento_idx" ON "parcela"("cliente_id", "situacao", "vencimento");

-- CreateIndex
CREATE INDEX "parcela_conta_baixa_id_data_baixa_idx" ON "parcela"("conta_baixa_id", "data_baixa");

-- CreateIndex
CREATE UNIQUE INDEX "parcela_titulo_id_numero_key" ON "parcela"("titulo_id", "numero");

-- CreateIndex
CREATE INDEX "transferencia_cliente_id_data_idx" ON "transferencia"("cliente_id", "data");

-- CreateIndex
CREATE UNIQUE INDEX "extrato_importado_conta_bancaria_id_sha256_key" ON "extrato_importado"("conta_bancaria_id", "sha256");

-- CreateIndex
CREATE INDEX "transacao_bancaria_conta_bancaria_id_data_idx" ON "transacao_bancaria"("conta_bancaria_id", "data");

-- CreateIndex
CREATE INDEX "transacao_bancaria_cliente_id_situacao_idx" ON "transacao_bancaria"("cliente_id", "situacao");

-- CreateIndex
CREATE UNIQUE INDEX "transacao_bancaria_conta_bancaria_id_impressao_digital_key" ON "transacao_bancaria"("conta_bancaria_id", "impressao_digital");

-- CreateIndex
CREATE INDEX "conciliacao_conta_bancaria_id_idx" ON "conciliacao"("conta_bancaria_id");

-- CreateIndex
CREATE UNIQUE INDEX "regra_conciliacao_cliente_id_texto_key" ON "regra_conciliacao"("cliente_id", "texto");

-- CreateIndex
CREATE UNIQUE INDEX "fechamento_conciliacao_conta_bancaria_id_competencia_key" ON "fechamento_conciliacao"("conta_bancaria_id", "competencia");

-- CreateIndex
CREATE UNIQUE INDEX "item_checklist_bpo_cliente_id_competencia_ordem_key" ON "item_checklist_bpo"("cliente_id", "competencia", "ordem");

-- AddForeignKey
ALTER TABLE "documento" ADD CONSTRAINT "documento_titulo_financeiro_id_fkey" FOREIGN KEY ("titulo_financeiro_id") REFERENCES "titulo_financeiro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conta_bancaria" ADD CONSTRAINT "conta_bancaria_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conta_bancaria" ADD CONSTRAINT "conta_bancaria_conta_contabil_id_fkey" FOREIGN KEY ("conta_contabil_id") REFERENCES "conta_contabil"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categoria_financeira" ADD CONSTRAINT "categoria_financeira_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categoria_financeira" ADD CONSTRAINT "categoria_financeira_pai_id_fkey" FOREIGN KEY ("pai_id") REFERENCES "categoria_financeira"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categoria_financeira" ADD CONSTRAINT "categoria_financeira_conta_contabil_id_fkey" FOREIGN KEY ("conta_contabil_id") REFERENCES "conta_contabil"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "centro_de_custo" ADD CONSTRAINT "centro_de_custo_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorecido" ADD CONSTRAINT "favorecido_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorecido" ADD CONSTRAINT "favorecido_pessoa_id_fkey" FOREIGN KEY ("pessoa_id") REFERENCES "pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titulo_financeiro" ADD CONSTRAINT "titulo_financeiro_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titulo_financeiro" ADD CONSTRAINT "titulo_financeiro_favorecido_id_fkey" FOREIGN KEY ("favorecido_id") REFERENCES "favorecido"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rateio_titulo" ADD CONSTRAINT "rateio_titulo_titulo_id_fkey" FOREIGN KEY ("titulo_id") REFERENCES "titulo_financeiro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rateio_titulo" ADD CONSTRAINT "rateio_titulo_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categoria_financeira"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rateio_titulo" ADD CONSTRAINT "rateio_titulo_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "centro_de_custo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcela" ADD CONSTRAINT "parcela_titulo_id_fkey" FOREIGN KEY ("titulo_id") REFERENCES "titulo_financeiro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcela" ADD CONSTRAINT "parcela_conciliacao_id_fkey" FOREIGN KEY ("conciliacao_id") REFERENCES "conciliacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extrato_importado" ADD CONSTRAINT "extrato_importado_conta_bancaria_id_fkey" FOREIGN KEY ("conta_bancaria_id") REFERENCES "conta_bancaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transacao_bancaria" ADD CONSTRAINT "transacao_bancaria_conta_bancaria_id_fkey" FOREIGN KEY ("conta_bancaria_id") REFERENCES "conta_bancaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transacao_bancaria" ADD CONSTRAINT "transacao_bancaria_extrato_id_fkey" FOREIGN KEY ("extrato_id") REFERENCES "extrato_importado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transacao_bancaria" ADD CONSTRAINT "transacao_bancaria_conciliacao_id_fkey" FOREIGN KEY ("conciliacao_id") REFERENCES "conciliacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliacao" ADD CONSTRAINT "conciliacao_conta_bancaria_id_fkey" FOREIGN KEY ("conta_bancaria_id") REFERENCES "conta_bancaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regra_conciliacao" ADD CONSTRAINT "regra_conciliacao_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regra_conciliacao" ADD CONSTRAINT "regra_conciliacao_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categoria_financeira"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regra_conciliacao" ADD CONSTRAINT "regra_conciliacao_favorecido_id_fkey" FOREIGN KEY ("favorecido_id") REFERENCES "favorecido"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fechamento_conciliacao" ADD CONSTRAINT "fechamento_conciliacao_conta_bancaria_id_fkey" FOREIGN KEY ("conta_bancaria_id") REFERENCES "conta_bancaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_financeira" ADD CONSTRAINT "config_financeira_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_checklist_bpo" ADD CONSTRAINT "item_checklist_bpo_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- Regras das fases 3 e 4
-- =============================================================================

ALTER TABLE titulo_financeiro ADD CONSTRAINT titulo_valor_positivo CHECK (valor_centavos > 0);
ALTER TABLE rateio_titulo ADD CONSTRAINT rateio_valor_positivo CHECK (valor_centavos > 0);
ALTER TABLE parcela ADD CONSTRAINT parcela_valor_positivo CHECK (valor_centavos > 0);
ALTER TABLE parcela ADD CONSTRAINT parcela_acrescimos_nao_negativos CHECK (juros_centavos >= 0 AND multa_centavos >= 0 AND desconto_centavos >= 0);
ALTER TABLE parcela ADD CONSTRAINT parcela_baixa_completa CHECK (
  (situacao = 'BAIXADA') = (data_baixa IS NOT NULL AND valor_baixa_centavos IS NOT NULL AND conta_baixa_id IS NOT NULL));
ALTER TABLE transferencia ADD CONSTRAINT transferencia_valor_positivo CHECK (valor_centavos > 0);
ALTER TABLE transferencia ADD CONSTRAINT transferencia_contas_distintas CHECK (origem_id <> destino_id);
ALTER TABLE transacao_bancaria ADD CONSTRAINT transacao_valor_nao_zero CHECK (valor_centavos <> 0);
ALTER TABLE config_financeira ADD CONSTRAINT config_limites CHECK (tolerancia_dias BETWEEN 0 AND 30 AND limite_automatico BETWEEN 0 AND 101);
ALTER TABLE fechamento_conciliacao ADD CONSTRAINT fechamento_conc_dia_1 CHECK (EXTRACT(DAY FROM competencia) = 1);

-- Soma dos rateios e soma das parcelas = valor do título (conferido no COMMIT).
CREATE OR REPLACE FUNCTION verificar_titulo(p_titulo uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v bigint; r bigint; p bigint;
BEGIN
  SELECT valor_centavos INTO v FROM titulo_financeiro WHERE id = p_titulo;
  IF v IS NULL THEN RETURN; END IF;
  SELECT coalesce(sum(valor_centavos), 0) INTO r FROM rateio_titulo WHERE titulo_id = p_titulo;
  SELECT coalesce(sum(valor_centavos), 0) INTO p FROM parcela WHERE titulo_id = p_titulo;
  IF r <> v OR p <> v THEN
    RAISE EXCEPTION 'Título %: valor %, rateios %, parcelas % (precisam ser iguais)', p_titulo, v, r, p
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION trg_titulo_fecha() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'titulo_financeiro' THEN
    PERFORM verificar_titulo(NEW.id);
  ELSE
    IF TG_OP IN ('UPDATE','DELETE') THEN PERFORM verificar_titulo(OLD.titulo_id); END IF;
    IF TG_OP IN ('INSERT','UPDATE') THEN PERFORM verificar_titulo(NEW.titulo_id); END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER titulo_fecha AFTER INSERT OR UPDATE ON titulo_financeiro
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_titulo_fecha();
CREATE CONSTRAINT TRIGGER rateio_fecha AFTER INSERT OR UPDATE OR DELETE ON rateio_titulo
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_titulo_fecha();
CREATE CONSTRAINT TRIGGER parcela_fecha AFTER INSERT OR UPDATE OR DELETE ON parcela
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_titulo_fecha();

-- Conciliação fechada trava as transações e as baixas daquela conta e mês.
CREATE OR REPLACE FUNCTION conciliacao_fechada(p_conta uuid, p_data date) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM fechamento_conciliacao
                  WHERE conta_bancaria_id = p_conta AND competencia = date_trunc('month', p_data)::date AND fechado)
$$;

CREATE OR REPLACE FUNCTION trg_bloqueio_conciliacao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'transacao_bancaria' THEN
    IF TG_OP <> 'INSERT' AND conciliacao_fechada(OLD.conta_bancaria_id, OLD.data) THEN
      RAISE EXCEPTION 'A conciliação de %/% desta conta está fechada', EXTRACT(MONTH FROM OLD.data), EXTRACT(YEAR FROM OLD.data)
        USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'INSERT' AND conciliacao_fechada(NEW.conta_bancaria_id, NEW.data) THEN
      RAISE EXCEPTION 'A conciliação de %/% desta conta está fechada: o extrato não pode trazer transações novas nesse mês', EXTRACT(MONTH FROM NEW.data), EXTRACT(YEAR FROM NEW.data)
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE -- parcela: só importa se já estava ou vai ficar baixada numa conta com mês fechado
    IF TG_OP <> 'INSERT' AND OLD.conta_baixa_id IS NOT NULL AND OLD.data_baixa IS NOT NULL
       AND conciliacao_fechada(OLD.conta_baixa_id, OLD.data_baixa)
       AND (NEW IS NULL OR NEW.data_baixa IS DISTINCT FROM OLD.data_baixa OR NEW.valor_baixa_centavos IS DISTINCT FROM OLD.valor_baixa_centavos
            OR NEW.conta_baixa_id IS DISTINCT FROM OLD.conta_baixa_id OR NEW.situacao IS DISTINCT FROM OLD.situacao OR NEW.conciliacao_id IS DISTINCT FROM OLD.conciliacao_id) THEN
      RAISE EXCEPTION 'A baixa pertence a um mês de conciliação fechada' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.conta_baixa_id IS NOT NULL AND NEW.data_baixa IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.data_baixa IS DISTINCT FROM OLD.data_baixa OR NEW.conta_baixa_id IS DISTINCT FROM OLD.conta_baixa_id)
       AND conciliacao_fechada(NEW.conta_baixa_id, NEW.data_baixa) THEN
      RAISE EXCEPTION 'Não é possível baixar num mês de conciliação fechada' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

CREATE TRIGGER transacao_bloqueio BEFORE INSERT OR UPDATE OR DELETE ON transacao_bancaria
  FOR EACH ROW EXECUTE FUNCTION trg_bloqueio_conciliacao();
CREATE TRIGGER parcela_bloqueio BEFORE INSERT OR UPDATE OR DELETE ON parcela
  FOR EACH ROW EXECUTE FUNCTION trg_bloqueio_conciliacao();

-- Auditoria nas tabelas novas
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conta_bancaria','categoria_financeira','favorecido','titulo_financeiro','rateio_titulo',
    'parcela','transferencia','extrato_importado','conciliacao','regra_conciliacao','fechamento_conciliacao','config_financeira'] LOOP
    EXECUTE format('CREATE TRIGGER auditar AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION trg_auditar()', t);
  END LOOP;
END $$;

-- Isolamento por escritório nas tabelas novas (as que ainda não têm RLS)
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
       AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_name = c.relname AND k.column_name = 'escritorio_id' AND k.table_schema = 'public')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY isolamento_escritorio ON %I
                     USING (escritorio_id = app_setting('app.escritorio_id')::uuid)
                     WITH CHECK (escritorio_id = app_setting('app.escritorio_id')::uuid)$p$, t);
  END LOOP;
END $$;

-- Dados financeiros: exclusão só lógica (títulos cancelados, transações ignoradas).
REVOKE DELETE ON titulo_financeiro, transacao_bancaria, extrato_importado, fechamento_conciliacao FROM app;
