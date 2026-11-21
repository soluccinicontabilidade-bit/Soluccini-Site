import nodemailer from "nodemailer";

// E-mail é opcional: sem SMTP_URL configurado, nada é enviado e quem chamou
// decide o que fazer (ex.: guardar o relatório como documento do cliente).
// Formato: smtps://usuario:senha@smtp.provedor.com:465
export const emailConfigurado = () => !!process.env.SMTP_URL && !!process.env.EMAIL_REMETENTE;

export async function enviarEmail(e: { para: string[]; assunto: string; texto: string; anexos?: { nome: string; conteudo: Buffer; tipo: string }[] }) {
  if (!emailConfigurado()) throw new Error("SMTP não configurado");
  const t = nodemailer.createTransport(process.env.SMTP_URL);
  await t.sendMail({
    from: process.env.EMAIL_REMETENTE,
    to: e.para.join(", "),
    subject: e.assunto,
    text: e.texto,
    attachments: e.anexos?.map((a) => ({ filename: a.nome, content: a.conteudo, contentType: a.tipo })),
  });
}
