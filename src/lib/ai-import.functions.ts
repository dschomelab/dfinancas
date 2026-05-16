import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const RowSchema = z.object({
  occurred_on: z.string(),
  description: z.string(),
  source: z.string().optional().nullable(),
  amount: z.number(),
  type: z.enum(["expense", "income"]),
});

const ResponseSchema = z.object({
  rows: z.array(RowSchema),
});

const SYSTEM_PROMPT = `Você é um extrator de lançamentos financeiros.

Receberá texto bruto de extrato bancário, fatura de cartão, comprovante ou recibo.

IMPORTANTE:
- Retorne APENAS JSON válido
- Nunca explique
- Nunca escreva texto antes ou depois do JSON
- Nunca use markdown
- Nunca use \`\`\`
- O JSON deve seguir EXATAMENTE este formato:

{
  "rows": [
    {
      "occurred_on": "YYYY-MM-DD",
      "description": "string",
      "source": "string|null",
      "amount": number,
      "type": "expense" | "income"
    }
  ]
}

REGRAS:
- "amount" pode ser positivo OU negativo (preserve o sinal original do lançamento — estornos/devoluções podem aparecer negativos numa fatura de cartão, por exemplo)
- "type" = "expense" para débitos/saídas (mesmo que o valor venha negativo)
- "type" = "income" para créditos/entradas
- "source" = banco/cartão/origem quando identificável, senão null
- Ignore saldos, totais, resumos, limites e taxas
- Extraia APENAS lançamentos individuais`;

export const extractTransactionsFromText = createServerFn({
  method: "POST",
})
  .inputValidator(
    (d: {
      text: string;
      defaultType: "expense" | "income";
      hint?: string;
    }) => d,
  )
  .handler(async ({ data }) => {
    // Endpoint da IA local (Ollama) configurável por env
    // AI_BASE_URL aceita ".../v1" ou raiz; normalizamos para a raiz.
    const rawBase =
      process.env.AI_BASE_URL?.trim() ||
      "http://192.168.1.158:11434/v1";
    const baseUrl = rawBase.replace(/\/?v1\/?$/, "").replace(/\/+$/, "");
    const model = process.env.AI_MODEL?.trim() || "qwen2.5:7b";

    const truncated = data.text.slice(0, 4000);

    const userMsg = `
Tipo padrão sugerido: ${data.defaultType}.
${data.hint ? `Contexto/origem: ${data.hint}` : ""}

Texto:
${truncated}
`.trim();

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 600000);

    try {
      const endpoint = `${baseUrl}/v1/chat/completions`;

      console.log("=== OLLAMA REQUEST ===");
      console.log("Endpoint:", endpoint);
      console.log("Modelo:", model);

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: userMsg,
            },
          ],
          temperature: 0,
          max_tokens:1000,
        }),
      });

      console.log("STATUS:", res.status);

      if (!res.ok) {
        const txt = await res.text();

        console.error("Erro IA:", txt);

        throw new Error(
          `Falha na IA (${res.status}): ${txt.slice(0, 300)}`,
        );
      }

      const json = await res.json();

      console.log("Resposta recebida:", json);

      const content =
        json?.choices?.[0]?.message?.content;

      if (!content) {
        console.error("Resposta inválida:", json);

        throw new Error("Resposta vazia da IA.");
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(content);
      } catch {
        console.error("JSON inválido:", content);

        throw new Error(
          "A IA retornou JSON inválido.",
        );
      }

      const result = ResponseSchema.safeParse(parsed);

      if (!result.success) {
        console.error(
          "Schema inválido:",
          result.error.flatten(),
        );

        return {
          rows: [] as z.infer<typeof RowSchema>[],
          error:
            "Estrutura inesperada na resposta da IA.",
        };
      }

      return {
        rows: result.data.rows,
      };
    } catch (error) {
      console.error("Erro geral:", error);

      if (
        error instanceof Error &&
        error.name === "AbortError"
      ) {
        throw new Error(
          "A IA demorou muito para responder.",
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  });