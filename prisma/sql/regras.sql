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
-- 5. Período fechado não aceita alteração
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION periodo_situacao(p_periodo uuid) RETURNS "SituacaoPeriodo"
LANGUAGE sql STABLE AS $$ SELECT situacao FROM periodo_contabil WHERE id = p_periodo $$;

CREATE OR REPLACE FUNCTION trg_bloqueio_periodo_fechado() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE pid uuid;
BEGIN
  IF TG_TABLE_NAME = 'lancamento_contabil' THEN
    IF TG_OP <> 'INSERT' AND periodo_situacao(OLD.periodo_id) = 'FECHADO' THEN
      RAISE EXCEPTION 'Período fechado: o lançamento % não pode ser alterado', OLD.numero
        USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP <> 'DELETE' AND periodo_situacao(NEW.periodo_id) = 'FECHADO' THEN
      RAISE EXCEPTION 'Período fechado: não aceita novos lançamentos'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE -- partida
    IF TG_OP <> 'INSERT' THEN
      SELECT periodo_id INTO pid FROM lancamento_contabil WHERE id = OLD.lancamento_id;
      IF periodo_situacao(pid) = 'FECHADO' THEN
        RAISE EXCEPTION 'Período fechado: partidas não podem ser alteradas'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT periodo_id INTO pid FROM lancamento_contabil WHERE id = NEW.lancamento_id;
      IF periodo_situacao(pid) = 'FECHADO' THEN
        RAISE EXCEPTION 'Período fechado: partidas não podem ser incluídas'
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
-- Sair de FECHADO exige perfil CONTADOR (ou ADMINISTRADOR) e justificativa
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
     AND coalesce(app_setting('app.perfil'), '') NOT IN ('CONTADOR','ADMINISTRADOR') THEN
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
