// Testes usam um banco próprio (TEST_DATABASE_URL), com as migrações aplicadas
// e a conexão pelo papel restrito da aplicação, como em produção.
import { randomBytes } from "node:crypto";

process.env.CHAVE_CIFRA ??= randomBytes(32).toString("base64");
process.env.CHAVE_INDICE ??= randomBytes(32).toString("base64");
process.env.ARMAZENAMENTO = "local";
process.env.ARMAZENAMENTO_DIR ??= `/tmp/soluccini-testes-${process.pid}`;
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
