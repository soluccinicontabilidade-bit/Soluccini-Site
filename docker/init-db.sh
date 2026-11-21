#!/bin/bash
# Cria o usuário de conexão da aplicação. Ele herda o papel "app", criado pela
# primeira migração, e nunca é dono das tabelas (o RLS vale para ele).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN CREATE ROLE app NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD '${APP_DB_PASSWORD}' IN ROLE app;
  END IF;
END \$\$;
SQL
