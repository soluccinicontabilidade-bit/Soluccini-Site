// Pix "copia e cola" estático (BR Code, padrão EMV do Banco Central), com
// valor e identificador. Não depende de banco ou intermediário: o pagamento
// cai direto na chave Pix do escritório. A baixa é feita pelo escritório
// (conferindo o extrato) ou, no futuro, por um provedor com aviso automático.

function campo(id: string, valor: string): string {
  if (valor.length > 99) throw new Error(`Campo Pix ${id} longo demais`);
  return `${id}${String(valor.length).padStart(2, "0")}${valor}`;
}

/** CRC16/CCITT-FALSE (polinômio 0x1021, início 0xFFFF), exigido pelo BR Code. */
export function crc16(texto: string): string {
  let crc = 0xffff;
  for (const b of Buffer.from(texto, "utf8")) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Remove acentos e caracteres fora do permitido (nome e cidade do recebedor). */
const limpar = (s: string, max: number) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 .\-]/g, "").trim().slice(0, max).toUpperCase();

export interface DadosPix {
  chave: string;
  nome: string;
  cidade: string;
  valorCentavos?: bigint;
  txid: string; // até 25 caracteres alfanuméricos
  descricao?: string;
}

export function validarChavePix(chave: string): string | null {
  const c = chave.trim();
  if (/^[0-9]{11}$/.test(c) || /^[0-9]{14}$/.test(c)) return null; // CPF ou CNPJ só com dígitos
  if (/^\+55[0-9]{10,11}$/.test(c)) return null; // telefone
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) && c.length <= 77) return null; // e-mail
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) return null; // aleatória
  return "Chave Pix inválida. Use CPF/CNPJ só com números, e-mail, telefone no formato +5511999999999 ou a chave aleatória.";
}

export function gerarPixCopiaECola(d: DadosPix): string {
  const txid = d.txid.replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  const conta = campo("00", "br.gov.bcb.pix") + campo("01", d.chave.trim()) + (d.descricao ? campo("02", limpar(d.descricao, 40)) : "");
  let payload =
    campo("00", "01") +
    campo("26", conta) +
    campo("52", "0000") +
    campo("53", "986") +
    (d.valorCentavos ? campo("54", `${d.valorCentavos / 100n}.${String(d.valorCentavos % 100n).padStart(2, "0")}`) : "") +
    campo("58", "BR") +
    campo("59", limpar(d.nome, 25)) +
    campo("60", limpar(d.cidade, 15)) +
    campo("62", campo("05", txid));
  payload += "6304";
  return payload + crc16(payload);
}
