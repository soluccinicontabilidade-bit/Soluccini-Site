#!/usr/bin/env bash
# Backup cifrado do banco e dos arquivos. Agende 1 vez por dia (cron).
# Uso: BACKUP_CHAVE=... MIGRATE_DATABASE_URL=... ARMAZENAMENTO_DIR=... scripts/backup.sh /caminho/dos/backups
# - Banco: pg_dump em formato custom, cifrado com AES-256 (openssl, PBKDF2).
# - Arquivos (armazenamento local): tar.gz cifrado. Com S3, use o versionamento e a
#   replicação do próprio bucket (os arquivos já estão cifrados pela aplicação).
# Guarde BACKUP_CHAVE fora do servidor (cofre de senhas). Sem ela, o backup não abre.
set -euo pipefail
DESTINO="${1:?informe a pasta de destino}"
: "${BACKUP_CHAVE:?defina BACKUP_CHAVE}"
: "${MIGRATE_DATABASE_URL:?defina MIGRATE_DATABASE_URL}"
mkdir -p "$DESTINO"
DATA="$(date -u +%Y%m%dT%H%M%SZ)"
pg_dump --format=custom --no-owner "$MIGRATE_DATABASE_URL" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_CHAVE -out "$DESTINO/banco-$DATA.dump.enc"
if [ -n "${ARMAZENAMENTO_DIR:-}" ] && [ -d "$ARMAZENAMENTO_DIR" ]; then
  tar -czf - -C "$ARMAZENAMENTO_DIR" . \
    | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_CHAVE -out "$DESTINO/arquivos-$DATA.tar.gz.enc"
fi
sha256sum "$DESTINO"/*-"$DATA".* > "$DESTINO/conferencia-$DATA.sha256"
# Mantém 35 dias de backups.
find "$DESTINO" -type f -mtime +35 -delete
echo "Backup concluído: $DESTINO (*-$DATA.*)"
