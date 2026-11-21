import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { cifrar, decifrar } from "@/lib/cripto";

// Os arquivos são cifrados na aplicação (AES-256-GCM) antes de sair do
// servidor. O provedor de armazenamento nunca vê o conteúdo em claro.

interface Armazenamento {
  gravar(chave: string, dados: Buffer): Promise<void>;
  ler(chave: string): Promise<Buffer>;
}

function validarChave(chave: string) {
  if (!/^[a-zA-Z0-9/_-]+$/.test(chave) || chave.includes("..")) throw new Error("Chave de arquivo inválida");
}

class Local implements Armazenamento {
  constructor(private raiz: string) {}
  private caminho(chave: string) {
    validarChave(chave);
    return path.join(this.raiz, chave);
  }
  async gravar(chave: string, dados: Buffer) {
    const p = this.caminho(chave);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, dados, { flag: "wx" }); // nunca sobrescreve
  }
  ler(chave: string) {
    return readFile(this.caminho(chave));
  }
}

class S3 implements Armazenamento {
  private s3 = new S3Client({
    region: process.env.S3_REGIAO || "sa-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: process.env.S3_ACCESS_KEY_ID
      ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" }
      : undefined,
  });
  private bucket = process.env.S3_BUCKET ?? "";
  async gravar(chave: string, dados: Buffer) {
    validarChave(chave);
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: chave, Body: dados, IfNoneMatch: "*", ContentType: "application/octet-stream" }),
    );
  }
  async ler(chave: string) {
    validarChave(chave);
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: chave }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
}

let instancia: Armazenamento | null = null;
function armazenamento(): Armazenamento {
  instancia ??= process.env.ARMAZENAMENTO === "s3" ? new S3() : new Local(path.resolve(process.env.ARMAZENAMENTO_DIR || ".armazenamento"));
  return instancia;
}

export const gravarArquivo = (chave: string, conteudo: Buffer) => armazenamento().gravar(chave, Buffer.from(cifrar(conteudo)));
export const lerArquivo = async (chave: string) => decifrar(await armazenamento().ler(chave));
