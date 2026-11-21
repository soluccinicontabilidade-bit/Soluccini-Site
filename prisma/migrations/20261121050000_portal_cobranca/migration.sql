-- CreateEnum
CREATE TYPE "RecorrenciaTarefa" AS ENUM ('NENHUMA', 'MENSAL', 'ANUAL');

-- CreateEnum
CREATE TYPE "ModuloRelatorio" AS ENUM ('CONTABIL', 'FINANCEIRO');

-- CreateEnum
CREATE TYPE "SituacaoEnvio" AS ENUM ('ENVIADO', 'GUARDADO_SEM_EMAIL', 'FALHOU');

-- CreateEnum
CREATE TYPE "SituacaoCobranca" AS ENUM ('PENDENTE', 'PAGA', 'CANCELADA');

-- CreateTable
CREATE TABLE "tentativa_acesso" (
    "id" BIGSERIAL NOT NULL,
    "ip" INET NOT NULL,
    "ocorrida_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tentativa_acesso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tarefa" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "responsavel_id" UUID,
    "prazo" DATE NOT NULL,
    "recorrencia" "RecorrenciaTarefa" NOT NULL DEFAULT 'NENHUMA',
    "concluida_em" TIMESTAMPTZ(3),
    "concluida_por_id" UUID,
    "anterior_id" UUID,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tarefa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacao" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "link" TEXT,
    "chave" TEXT NOT NULL,
    "lida_em" TIMESTAMPTZ(3),
    "criada_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agendamento_relatorio" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "modulo" "ModuloRelatorio" NOT NULL,
    "tipo" TEXT NOT NULL,
    "dia_do_mes" INTEGER NOT NULL,
    "destinatarios" TEXT[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultima_competencia" DATE,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agendamento_relatorio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "envio_relatorio" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "agendamento_id" UUID NOT NULL,
    "competencia" DATE NOT NULL,
    "situacao" "SituacaoEnvio" NOT NULL,
    "documento_id" UUID,
    "erro" TEXT,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "envio_relatorio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_escritorio" (
    "escritorio_id" UUID NOT NULL,
    "chave_pix" TEXT,
    "nome_recebedor" VARCHAR(25),
    "cidade_recebedor" VARCHAR(15),
    "provedor_cobranca" TEXT NOT NULL DEFAULT 'pix-estatico',

    CONSTRAINT "config_escritorio_pkey" PRIMARY KEY ("escritorio_id")
);

-- CreateTable
CREATE TABLE "cobranca" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "contrato_id" UUID,
    "competencia" DATE NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor_centavos" BIGINT NOT NULL,
    "vencimento" DATE NOT NULL,
    "situacao" "SituacaoCobranca" NOT NULL DEFAULT 'PENDENTE',
    "provedor" TEXT NOT NULL,
    "txid" VARCHAR(25) NOT NULL,
    "pix_copia_e_cola" TEXT,
    "id_externo" TEXT,
    "linha_digitavel" TEXT,
    "url_boleto" TEXT,
    "paga_em" DATE,
    "valor_pago_centavos" BIGINT,
    "baixa_por_id" UUID,
    "cancelada_em" TIMESTAMPTZ(3),
    "motivo_cancelamento" TEXT,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cobranca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitacao_aceite" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "versao_id" UUID NOT NULL,
    "mensagem" TEXT,
    "solicitado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelada_em" TIMESTAMPTZ(3),

    CONSTRAINT "solicitacao_aceite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aceite_documento" (
    "id" UUID NOT NULL,
    "escritorio_id" UUID NOT NULL,
    "solicitacao_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "nome_usuario" TEXT NOT NULL,
    "email_usuario" TEXT NOT NULL,
    "sha256_documento" CHAR(64) NOT NULL,
    "ip" INET,
    "user_agent" TEXT,
    "aceito_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aceite_documento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tentativa_acesso_ip_ocorrida_em_idx" ON "tentativa_acesso"("ip", "ocorrida_em");

-- CreateIndex
CREATE UNIQUE INDEX "tarefa_anterior_id_key" ON "tarefa"("anterior_id");

-- CreateIndex
CREATE INDEX "tarefa_escritorio_id_prazo_idx" ON "tarefa"("escritorio_id", "prazo");

-- CreateIndex
CREATE INDEX "tarefa_responsavel_id_concluida_em_idx" ON "tarefa"("responsavel_id", "concluida_em");

-- CreateIndex
CREATE INDEX "notificacao_usuario_id_lida_em_idx" ON "notificacao"("usuario_id", "lida_em");

-- CreateIndex
CREATE UNIQUE INDEX "notificacao_usuario_id_chave_key" ON "notificacao"("usuario_id", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "cobranca_txid_key" ON "cobranca"("txid");

-- CreateIndex
CREATE INDEX "cobranca_escritorio_id_situacao_vencimento_idx" ON "cobranca"("escritorio_id", "situacao", "vencimento");

-- CreateIndex
CREATE UNIQUE INDEX "cobranca_contrato_id_competencia_key" ON "cobranca"("contrato_id", "competencia");

-- CreateIndex
CREATE INDEX "solicitacao_aceite_cliente_id_idx" ON "solicitacao_aceite"("cliente_id");

-- CreateIndex
CREATE UNIQUE INDEX "aceite_documento_solicitacao_id_usuario_id_key" ON "aceite_documento"("solicitacao_id", "usuario_id");

-- AddForeignKey
ALTER TABLE "tarefa" ADD CONSTRAINT "tarefa_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamento_relatorio" ADD CONSTRAINT "agendamento_relatorio_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envio_relatorio" ADD CONSTRAINT "envio_relatorio_agendamento_id_fkey" FOREIGN KEY ("agendamento_id") REFERENCES "agendamento_relatorio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobranca" ADD CONSTRAINT "cobranca_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacao_aceite" ADD CONSTRAINT "solicitacao_aceite_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aceite_documento" ADD CONSTRAINT "aceite_documento_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacao_aceite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Regras das fases 6 e 7
ALTER TABLE agendamento_relatorio ADD CONSTRAINT agendamento_dia CHECK (dia_do_mes BETWEEN 1 AND 28);
ALTER TABLE cobranca ADD CONSTRAINT cobranca_valor CHECK (valor_centavos > 0);
ALTER TABLE cobranca ADD CONSTRAINT cobranca_paga CHECK ((situacao = 'PAGA') = (paga_em IS NOT NULL AND valor_pago_centavos IS NOT NULL));

-- Aceite é evidência: não muda nem some.
CREATE TRIGGER aceite_imutavel BEFORE UPDATE OR DELETE ON aceite_documento FOR EACH ROW EXECUTE FUNCTION trg_auditoria_imutavel();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tarefa','agendamento_relatorio','cobranca','solicitacao_aceite','aceite_documento'] LOOP
    EXECUTE format('CREATE TRIGGER auditar AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION trg_auditar()', t);
  END LOOP;
END $$;

-- config_escritorio usa escritorio_id como chave: entra no laço de RLS abaixo.
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

-- Rotinas automáticas (relatórios agendados, avisos) percorrem os escritórios:
-- só a lista de ids fica visível, e só com app.rotina_sistema = 'sim'.
CREATE POLICY rotina_lista_escritorios ON escritorio FOR SELECT USING (app_setting('app.rotina_sistema') = 'sim');

REVOKE UPDATE, DELETE ON aceite_documento FROM app;
REVOKE DELETE ON cobranca FROM app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app;

-- 2FA: último passo de tempo aceito (bloqueia reuso do mesmo código)
ALTER TABLE "usuario" ADD COLUMN "totp_ultimo_passo" BIGINT;
