#!/usr/bin/env bash
# Testa o backup mais recente: restaura num banco temporário e confere contagens.
# Rode pelo menos 1 vez por mês. Uso:
# BACKUP_CHAVE=... ADMIN_DATABASE_URL=postgresql://postgres:...@host:5432/postgres scripts/testar-restauracao.sh /caminho/dos/backups
set -euo pipefail
ORIGEM="${1:?informe a pasta dos backups}"
: "${BACKUP_CHAVE:?defina BACKUP_CHAVE}"
: "${ADMIN_DATABASE_URL:?defina ADMIN_DATABASE_URL (usuário com permissão de criar banco)}"
ARQ="$(ls -1t "$ORIGEM"/banco-*.dump.enc | head -1)"
TEMP="restauracao_teste_$(date +%s)"
echo "Restaurando $ARQ em $TEMP..."
psql "$ADMIN_DATABASE_URL" -qc "CREATE DATABASE $TEMP"
URL_TEMP="$(printf %s "$ADMIN_DATABASE_URL" | sed -E "s#/([^/?]*)(\?|$)#/$TEMP\2#")"
trap 'psql "$ADMIN_DATABASE_URL" -qc "DROP DATABASE IF EXISTS $TEMP"' EXIT
psql "$URL_TEMP" -qc "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app') THEN CREATE ROLE app NOLOGIN; END IF; END\$\$"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_CHAVE -in "$ARQ" | pg_restore --no-owner --exit-on-error -d "$URL_TEMP"
psql "$URL_TEMP" -At -c "SELECT 'clientes: ' || count(*) FROM cliente" -c "SELECT 'lançamentos: ' || count(*) FROM lancamento_contabil" -c "SELECT 'auditoria: ' || count(*) FROM registro_auditoria" -c "SELECT 'migrações: ' || count(*) FROM _prisma_migrations"
echo "Restauração OK."
