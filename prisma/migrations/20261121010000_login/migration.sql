-- Login e sessão sem furar o isolamento entre escritórios.
-- Antes do login não se sabe o escritório. Em vez de dar ao papel da
-- aplicação acesso livre, liberamos leituras estreitas:
--   usuario: só as linhas com o e-mail exato informado em app.auth_email
--   sessao:  só a linha cujo hash é exatamente app.auth_token_hash
-- Depois de identificar o usuário, a aplicação define app.escritorio_id e
-- todas as demais operações seguem a política normal.

CREATE POLICY login_por_email ON usuario FOR SELECT
  USING (app_setting('app.auth_email') IS NOT NULL
         AND email = app_setting('app.auth_email')::citext);

CREATE POLICY sessao_por_token ON sessao FOR SELECT
  USING (app_setting('app.auth_token_hash') IS NOT NULL
         AND token_hash = app_setting('app.auth_token_hash'));

-- Tabelas criadas por migrações futuras já nascem acessíveis ao papel app
-- (o RLS de cada uma continua sendo criado na própria migração).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO app;

-- Inatividade medida pela sessão (a tabela sessao não é auditada; usuario é).
ALTER TABLE "sessao" ADD COLUMN "ultimo_uso_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
