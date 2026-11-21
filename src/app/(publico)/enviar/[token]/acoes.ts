"use server";

import { revalidatePath } from "next/cache";
import { ErroDeNegocio } from "@/lib/erros";
import { estadoDeErro, type EstadoForm } from "@/lib/form";
import { enviarPeloLink } from "@/lib/irpf/irpf";
import { TAMANHO_MAXIMO } from "@/lib/documentos";

export async function acaoEnviarPeloLink(token: string, itemId: string, _: EstadoForm, f: FormData): Promise<EstadoForm> {
  try {
    const arq = f.get("arquivo");
    if (!(arq instanceof File) || arq.size === 0) throw new ErroDeNegocio("Escolha o arquivo.");
    if (arq.size > TAMANHO_MAXIMO) throw new ErroDeNegocio("O arquivo passa de 20 MB.");
    await enviarPeloLink(token, itemId, { nome: arq.name, tipo: arq.type, conteudo: Buffer.from(await arq.arrayBuffer()) });
    revalidatePath(`/enviar/${token}`);
    return { ok: true, mensagem: "Arquivo recebido. Obrigado!" };
  } catch (e) {
    return estadoDeErro(e);
  }
}
