import { Prisma, PrismaClient, type PerfilUsuario } from "@prisma/client";

const global = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = global.prisma ?? new PrismaClient({ log: ["warn", "error"] });
if (process.env.NODE_ENV !== "production") global.prisma = prisma;

export type Tx = Prisma.TransactionClient;

export interface ContextoBanco {
  escritorioId: string;
  usuarioId?: string | null;
  perfil?: PerfilUsuario | null;
  ip?: string | null;
  origem?: string;
}

async function definir(tx: Tx, nome: string, valor: string | null | undefined) {
  // set_config(..., true) vale só até o fim desta transação.
  await tx.$executeRaw`select set_config(${nome}, ${valor ?? ""}, true)`;
}

/**
 * Toda leitura e escrita de dados passa por aqui. A transação recebe as
 * variáveis que o PostgreSQL usa para o isolamento (RLS), para a auditoria e
 * para as regras de período. Sem elas, o banco não mostra nenhuma linha.
 */
export async function comEscritorio<T>(
  ctx: ContextoBanco,
  fn: (tx: Tx) => Promise<T>,
  opcoes?: { timeout?: number },
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await definirContexto(tx, ctx);
      return fn(tx);
    },
    { timeout: opcoes?.timeout ?? 15000, maxWait: 5000 },
  );
}

export async function definirContexto(tx: Tx, ctx: ContextoBanco) {
  await definir(tx, "app.escritorio_id", ctx.escritorioId);
  await definir(tx, "app.usuario_id", ctx.usuarioId ?? "");
  await definir(tx, "app.perfil", ctx.perfil ?? "");
  await definir(tx, "app.ip", ctx.ip ?? "");
  await definir(tx, "app.origem", ctx.origem ?? "web");
}

/** Transação para login e sessão, antes de o escritório ser conhecido. */
export async function comAutenticacao<T>(
  chaves: { email?: string; tokenHash?: string; ip?: string | null },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    if (chaves.email) await definir(tx, "app.auth_email", chaves.email);
    if (chaves.tokenHash) await definir(tx, "app.auth_token_hash", chaves.tokenHash);
    await definir(tx, "app.ip", chaves.ip ?? "");
    await definir(tx, "app.origem", "web:login");
    return fn(tx);
  });
}

export function ehViolacaoUnica(e: unknown, campo?: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  if (!campo) return true;
  const alvo = (e.meta?.target ?? []) as string[] | string;
  return String(alvo).includes(campo);
}

/** Mensagem do banco quando uma regra (trigger/CHECK) recusa a operação. */
export function mensagemDoBanco(e: unknown): string | null {
  const texto = e instanceof Error ? e.message : String(e);
  const m = texto.match(/(?:ERROR|Message):\s*`?([^`\n]+)/);
  return m ? m[1].trim() : null;
}
