-- CreateEnum
CREATE TYPE "SituacaoDeclaracao" AS ENUM ('AGUARDANDO_DOCUMENTOS', 'EM_ANALISE', 'EM_DIGITACAO', 'EM_REVISAO', 'TRANSMITIDA', 'MALHA_FINA', 'FINALIZADA');

-- CreateEnum
CREATE TYPE "ModeloDeclaracao" AS ENUM ('COMPLETO', 'SIMPLIFICADO');

-- CreateEnum
CREATE TYPE "CategoriaItemIRPF" AS ENUM ('INFORME_RENDIMENTOS', 'SAUDE', 'EDUCACAO', 'PREVIDENCIA', 'DEPENDENTES', 'BENS_DIREITOS', 'DIVIDAS', 'ALUGUEIS', 'CARNE_LEAO', 'RENDA_VARIAVEL', 'GANHO_CAPITAL', 'OUTROS');

-- CreateEnum
CREATE TYPE "SituacaoItemIRPF" AS ENUM ('PENDENTE', 'RECEBIDO', 'CONFERIDO', 'NAO_SE_APLICA');

-- CreateTable
CREATE TABLE "tabela_irpf" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "ano_calendario" INTEGER NOT NULL,
    "parametros" JSONB NOT NULL,
    "confirmada" BOOLEAN NOT NULL DEFAULT false,
    "fonte" TEXT,
    "prazo_entrega" DATE,
    "atualizado_por_id" UUID,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tabela_irpf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "declaracao_irpf" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "pessoa_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "ano_calendario" INTEGER NOT NULL,
    "situacao" "SituacaoDeclaracao" NOT NULL DEFAULT 'AGUARDANDO_DOCUMENTOS',
    "responsavel_id" UUID,
    "prazo" DATE,
    "honorario_centavos" BIGINT,
    "honorario_pago" BOOLEAN NOT NULL DEFAULT false,
    "modelo" "ModeloDeclaracao",
    "resultado_centavos" BIGINT,
    "recibo" TEXT,
    "transmitida_em" DATE,
    "retificadora" BOOLEAN NOT NULL DEFAULT false,
    "retificacoes" INTEGER NOT NULL DEFAULT 0,
    "pendencias_malha" TEXT,
    "simulacao" JSONB,
    "observacoes" TEXT,
    "ultimo_contato_em" TIMESTAMPTZ(3),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "declaracao_irpf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_documento_irpf" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "declaracao_id" UUID NOT NULL,
    "categoria" "CategoriaItemIRPF" NOT NULL,
    "descricao" TEXT NOT NULL,
    "situacao" "SituacaoItemIRPF" NOT NULL DEFAULT 'PENDENTE',
    "documento_id" UUID,
    "observacao" TEXT,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_documento_irpf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_declaracao" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "declaracao_id" UUID NOT NULL,
    "resumo" TEXT NOT NULL,
    "usuario_id" UUID,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evento_declaracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_envio" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "declaracao_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira_em" TIMESTAMPTZ(3) NOT NULL,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_uso_em" TIMESTAMPTZ(3),
    "revogado_em" TIMESTAMPTZ(3),

    CONSTRAINT "link_envio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tabela_irpf_escritorio_id_ano_calendario_key" ON "tabela_irpf"("escritorio_id", "ano_calendario");

-- CreateIndex
CREATE INDEX "declaracao_irpf_escritorio_id_ano_calendario_situacao_idx" ON "declaracao_irpf"("escritorio_id", "ano_calendario", "situacao");

-- CreateIndex
CREATE UNIQUE INDEX "declaracao_irpf_pessoa_id_ano_calendario_key" ON "declaracao_irpf"("pessoa_id", "ano_calendario");

-- CreateIndex
CREATE INDEX "item_documento_irpf_declaracao_id_idx" ON "item_documento_irpf"("declaracao_id");

-- CreateIndex
CREATE INDEX "evento_declaracao_declaracao_id_ocorrido_em_idx" ON "evento_declaracao"("declaracao_id", "ocorrido_em");

-- CreateIndex
CREATE UNIQUE INDEX "link_envio_token_hash_key" ON "link_envio"("token_hash");

-- AddForeignKey
ALTER TABLE "declaracao_irpf" ADD CONSTRAINT "declaracao_irpf_pessoa_id_fkey" FOREIGN KEY ("pessoa_id") REFERENCES "pessoa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaracao_irpf" ADD CONSTRAINT "declaracao_irpf_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_documento_irpf" ADD CONSTRAINT "item_documento_irpf_declaracao_id_fkey" FOREIGN KEY ("declaracao_id") REFERENCES "declaracao_irpf"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_declaracao" ADD CONSTRAINT "evento_declaracao_declaracao_id_fkey" FOREIGN KEY ("declaracao_id") REFERENCES "declaracao_irpf"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_envio" ADD CONSTRAINT "link_envio_declaracao_id_fkey" FOREIGN KEY ("declaracao_id") REFERENCES "declaracao_irpf"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Regras do IRPF
ALTER TABLE declaracao_irpf ADD CONSTRAINT declaracao_ano CHECK (ano_calendario BETWEEN 2000 AND 2100);
ALTER TABLE tabela_irpf ADD CONSTRAINT tabela_ano CHECK (ano_calendario BETWEEN 2000 AND 2100);

-- O contribuinte precisa ser pessoa física.
CREATE OR REPLACE FUNCTION trg_declaracao_pf() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT tipo FROM pessoa WHERE id = NEW.pessoa_id) <> 'PF' THEN
    RAISE EXCEPTION 'A declaração de IRPF é de pessoa física' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER declaracao_pf BEFORE INSERT OR UPDATE OF pessoa_id ON declaracao_irpf FOR EACH ROW EXECUTE FUNCTION trg_declaracao_pf();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tabela_irpf','declaracao_irpf','item_documento_irpf','link_envio'] LOOP
    EXECUTE format('CREATE TRIGGER auditar AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION trg_auditar()', t);
  END LOOP;
END $$;

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

-- Link público de envio: leitura estreita pelo hash exato do token (como na sessão).
CREATE POLICY link_por_token ON link_envio FOR SELECT
  USING (app_setting('app.auth_link_hash') IS NOT NULL AND token_hash = app_setting('app.auth_link_hash'));
