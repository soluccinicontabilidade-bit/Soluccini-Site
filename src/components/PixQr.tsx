import QRCode from "qrcode";

/** QR code do Pix copia e cola (gerado no servidor, sem serviço externo). */
export async function PixQr({ codigo, tamanho = 180 }: { codigo: string; tamanho?: number }) {
  const url = await QRCode.toDataURL(codigo, { margin: 1, width: tamanho, color: { dark: "#252638", light: "#FFFFFF" } });
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} width={tamanho} height={tamanho} alt="QR code do Pix" className="qr" />;
}
