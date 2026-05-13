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
Receberá texto bruto de um extrato bancário, fatura de cartão, ou recibo (em português ou inglês).
Retorne APENAS JSON válido com a estrutura: { "rows": [{ "occurred_on": "YYYY-MM-DD", "description": "string", "source": "string|null", "amount": number, "type": "expense"|"income" }] }
- "amount" sempre POSITIVO em reais.
- "type" = "expense" para débitos/saídas/pagamentos e "income" para créditos/entradas/recebimentos.
- "source" = banco/cartão/origem se identificável, senão null.
- Ignore totais, saldos, taxas resumo. Apenas lançamentos individuais.`;

export const extractTransactionsFromText = createServerFn({ method: "POST" })
  .inputValidator((d: { text: string; defaultType: "expense" | "income"; hint?: string }) => d)
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY ausente. Ative o Lovable AI Gateway.");

    const truncated = data.text.slice(0, 60000);
    const userMsg = `Tipo padrão sugerido: ${data.defaultType}. ${data.hint ? `Contexto/origem: ${data.hint}.` : ""}\n\nTexto:\n${truncated}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (res.status === 429) throw new Error("Limite de requisições atingido. Tente novamente em instantes.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados. Adicione créditos no workspace.");
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Falha na IA: ${res.status} ${txt.slice(0, 200)}`);
    }

    const json = await res.json();
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Resposta da IA inválida.");
    }
    const result = ResponseSchema.safeParse(parsed);
    if (!result.success) {
      return { rows: [] as z.infer<typeof RowSchema>[], error: "Estrutura inesperada na resposta da IA." };
    }
    return { rows: result.data.rows };
  });
