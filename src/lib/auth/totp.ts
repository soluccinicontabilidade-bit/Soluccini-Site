import { authenticator } from "otplib";
import QRCode from "qrcode";
import { randomInt } from "node:crypto";

// TOTP padrão (RFC 6238): 6 dígitos, 30 s, tolerância de 1 janela para relógio.
authenticator.options = { window: 1 };

export const gerarSegredoTotp = () => authenticator.generateSecret(20);

export const codigoTotpConfere = (segredo: string, codigo: string) =>
  authenticator.check(codigo.replace(/\s/g, ""), segredo);

/**
 * Confere o código e devolve o passo de tempo (janela de 30 s) a que ele
 * pertence, ou null. Guardar o último passo aceito impede reusar o código.
 */
export function passoDoCodigo(segredo: string, codigo: string): bigint | null {
  const delta = authenticator.checkDelta(codigo.replace(/\s/g, ""), segredo);
  if (delta === null) return null;
  return BigInt(Math.floor(Date.now() / 30_000) + delta);
}

export async function qrCodeTotp(segredo: string, email: string): Promise<string> {
  const emissor = process.env.TOTP_EMISSOR || "Soluccini";
  const uri = authenticator.keyuri(email, emissor, segredo);
  return QRCode.toDataURL(uri, { margin: 1, width: 220, color: { dark: "#252638", light: "#FFFFFF" } });
}

/** 10 códigos de recuperação de uso único, no formato xxxx-xxxx. */
export function gerarCodigosRecuperacao(): string[] {
  const alfabeto = "abcdefghjkmnpqrstuvwxyz23456789";
  const parte = () => Array.from({ length: 4 }, () => alfabeto[randomInt(alfabeto.length)]).join("");
  return Array.from({ length: 10 }, () => `${parte()}-${parte()}`);
}

export const normalizarCodigoRecuperacao = (c: string) => c.trim().toLowerCase().replace(/\s/g, "");
