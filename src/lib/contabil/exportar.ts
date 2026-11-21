import PDFDocument from "pdfkit";
import writeExcelFile from "write-excel-file/node";
import type { Tabela } from "./relatorios";
import { textoCelula } from "./relatorios";

export interface Cabecalho {
  escritorio: string;
  cliente: string;
  documento: string; // CNPJ completo (PJ) ou CPF mascarado (PF)
  periodo: string; // "01/03/2026 a 31/03/2026" ou "Em 31/03/2026"
  emitidoEm: string;
  emitidoPor: string;
}

const COLUNA_SALDO = (rotulo: string) => /saldo/i.test(rotulo); // colunas com D/C

function celulasTexto(t: Tabela, l: Tabela["linhas"][number]) {
  return l.celulas.map((c, i) => textoCelula(c, COLUNA_SALDO(t.colunas[i]?.rotulo ?? "")));
}

// CSV ------------------------------------------------------------------------

export function paraCsv(t: Tabela, cab: Cabecalho): string {
  const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const linhas = [
    [t.titulo], [cab.cliente, cab.documento], [cab.periodo], [],
    t.colunas.map((c) => c.rotulo),
    ...t.linhas.map((l) => celulasTexto(t, l).map((v, i) => (i === 0 && l.nivel ? "  ".repeat(l.nivel) + v : v))),
    [], ...(t.notas ?? []).map((n) => [n]), [`Emitido em ${cab.emitidoEm} por ${cab.emitidoPor} · ${cab.escritorio}`],
  ];
  return "﻿" + linhas.map((l) => l.map((v) => esc(String(v))).join(";")).join("\r\n") + "\r\n";
}

// XLSX -----------------------------------------------------------------------
// Valores vão como número (em reais) com formato brasileiro, para a pessoa
// poder somar no Excel. Saldos com D/C vão como texto.

export async function paraXlsx(t: Tabela, cab: Cabecalho): Promise<Buffer> {
  type Celula = { value?: string | number | null; fontWeight?: "bold"; format?: string; align?: "right" | "left"; type?: typeof String | typeof Number } | null;
  const negrito = (v: string): Celula => ({ value: v, fontWeight: "bold" });
  const dados: Celula[][] = [
    [negrito(t.titulo)],
    [{ value: `${cab.cliente} · ${cab.documento}` }],
    [{ value: cab.periodo }],
    [],
    t.colunas.map((c) => ({ value: c.rotulo, fontWeight: "bold", align: c.valor ? "right" : "left" })),
    ...t.linhas.map((l) =>
      l.celulas.map((c, i): Celula => {
        const bold = l.destaque ? ("bold" as const) : undefined;
        if (typeof c === "bigint") return { value: Number(c) / 100, type: Number, format: "#,##0.00", fontWeight: bold };
        const texto = textoCelula(c, COLUNA_SALDO(t.colunas[i]?.rotulo ?? ""));
        return { value: i === 0 && l.nivel ? "  ".repeat(l.nivel) + texto : texto, fontWeight: bold, align: t.colunas[i]?.valor ? "right" : undefined };
      }),
    ),
    [],
    ...(t.notas ?? []).map((n) => [{ value: n }] as Celula[]),
    [{ value: `Emitido em ${cab.emitidoEm} por ${cab.emitidoPor} · ${cab.escritorio}` }],
  ];
  const larguras = t.colunas.map((c) => ({ width: Math.round(12 * (c.largura ?? 1.2)) }));
  // Números grandes em centavos cabem com folga em double (até 2^53 centavos).
  return writeExcelFile(dados as never, { columns: larguras, sheet: t.titulo.slice(0, 31) } as never).toBuffer();
}

// PDF ------------------------------------------------------------------------

const ROXO = "#512878";
const GRAFITE = "#252638";
const SUAVE = "#55566B";
const BORDA = "#E3D9F0";
const LAVANDA = "#F4EFFA";

export function paraPdf(t: Tabela, cab: Cabecalho): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const largas = t.colunas.length > 5;
    const doc = new PDFDocument({ size: "A4", layout: largas ? "landscape" : "portrait", margins: { top: 56, bottom: 56, left: 51, right: 51 }, bufferPages: true, info: { Title: `${t.titulo} · ${cab.cliente}`, Author: cab.escritorio } });
    const partes: Buffer[] = [];
    doc.on("data", (b: Buffer) => partes.push(b));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);

    const largura = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const pesos = t.colunas.map((c) => c.largura ?? 1.2);
    const somaPesos = pesos.reduce((a, b) => a + b, 0);
    const larg = pesos.map((p) => (p / somaPesos) * largura);
    const x0 = doc.page.margins.left;

    const cabecalhoPagina = () => {
      doc.fillColor(ROXO).font("Helvetica-Bold").fontSize(9).text("SOLUCCINI.", x0, 28, { continued: false });
      doc.fillColor(SUAVE).font("Helvetica").fontSize(8).text(cab.escritorio, x0, 28, { width: largura, align: "right" });
      doc.moveTo(x0, 42).lineTo(x0 + largura, 42).lineWidth(0.5).strokeColor(BORDA).stroke();
    };
    const cabecalhoTabela = (y: number) => {
      doc.rect(x0, y, largura, 18).fill(LAVANDA);
      let x = x0;
      doc.fillColor(GRAFITE).font("Helvetica-Bold").fontSize(8);
      t.colunas.forEach((c, i) => {
        doc.text(c.rotulo, x + 4, y + 5, { width: larg[i] - 8, align: c.valor ? "right" : "left", lineBreak: false });
        x += larg[i];
      });
      return y + 20;
    };

    cabecalhoPagina();
    doc.fillColor(ROXO).font("Helvetica-Bold").fontSize(16).text(t.titulo, x0, 56);
    doc.fillColor(GRAFITE).font("Helvetica-Bold").fontSize(10).text(cab.cliente, x0, doc.y + 4);
    doc.font("Helvetica").fontSize(9).fillColor(SUAVE).text(`${cab.documento}  ·  ${cab.periodo}`);
    if (t.alerta) doc.moveDown(0.5).fillColor("#B42318").font("Helvetica-Bold").text(t.alerta);
    let y = cabecalhoTabela(doc.y + 12);
    const limite = doc.page.height - doc.page.margins.bottom;

    for (const l of t.linhas) {
      const textos = celulasTexto(t, l);
      doc.font(l.destaque ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      const recuo = (l.nivel ?? 0) * 6;
      const alturas = textos.map((s, i) => doc.heightOfString(s || " ", { width: larg[i] - 8 - (i <= 1 ? recuo : 0) }));
      const h = Math.max(...alturas) + 6;
      if (y + h > limite) {
        doc.addPage();
        cabecalhoPagina();
        y = cabecalhoTabela(56);
      }
      if (l.destaque === "total") doc.rect(x0, y - 1, largura, h).fill(LAVANDA);
      let x = x0;
      doc.fillColor(l.destaque === "grupo" ? ROXO : GRAFITE).font(l.destaque ? "Helvetica-Bold" : "Helvetica");
      textos.forEach((s, i) => {
        const r = i <= 1 ? recuo : 0;
        doc.text(s, x + 4 + r, y + 3, { width: larg[i] - 8 - r, align: t.colunas[i]?.valor ? "right" : "left" });
        x += larg[i];
      });
      y += h;
      doc.moveTo(x0, y - 1).lineTo(x0 + largura, y - 1).lineWidth(0.3).strokeColor(BORDA).stroke();
    }

    if (t.notas?.length) {
      y += 8;
      doc.font("Helvetica").fontSize(7.5).fillColor(SUAVE);
      for (const n of t.notas) {
        if (y > limite - 20) {
          doc.addPage();
          cabecalhoPagina();
          y = 56;
        }
        doc.text(n, x0, y, { width: largura });
        y = doc.y + 2;
      }
    }

    // Rodapé com numeração em todas as páginas.
    const total = doc.bufferedPageRange().count;
    for (let i = 0; i < total; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // o rodapé fica abaixo da margem; sem isso o pdfkit abriria outra página
      const yr = doc.page.height - 36;
      doc.font("Helvetica").fontSize(7.5).fillColor(SUAVE);
      doc.text(`Emitido em ${cab.emitidoEm} por ${cab.emitidoPor}`, x0, yr, { width: largura / 2, lineBreak: false });
      doc.text(`Página ${i + 1} de ${total}`, x0 + largura / 2, yr, { width: largura / 2, align: "right", lineBreak: false });
    }
    doc.end();
  });
}
