import Papa from "papaparse";
import { parseAmount, parseDateLoose, competenceFromDate } from "./format";

export type ParsedRow = {
  occurred_on: string;
  description: string;
  source?: string;
  amount: number;
  competence: string;
  type: "expense" | "income";
};

const DATE_KEYS = ["data", "date", "dt", "lançamento", "lancamento"];
const DESC_KEYS = ["descrição", "descricao", "description", "histórico", "historico", "memo", "detalhes", "title"];
const AMT_KEYS = ["valor", "amount", "value", "montante", "vlr"];
const SRC_KEYS = ["origem", "fonte", "source", "banco", "conta", "account", "cartao", "cartão"];

function pick(row: Record<string, string>, candidates: string[]) {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const k = keys.find((k) => k.toLowerCase().trim() === c);
    if (k) return row[k];
  }
  for (const c of candidates) {
    const k = keys.find((k) => k.toLowerCase().includes(c));
    if (k) return row[k];
  }
  return undefined;
}

export function inferSourceFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return base.replace(/[_-]+/g, " ").trim();
}

export function parseCsvText(
  text: string,
  defaultType: "expense" | "income",
  fallbackSource?: string,
): { rows: ParsedRow[]; errors: string[] } {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    delimiter: "",
    transformHeader: (h) => h.trim(),
  });

  const rows: ParsedRow[] = [];
  const errors: string[] = [];

  for (const r of result.data) {
    if (!r || typeof r !== "object") continue;
    const dateRaw = pick(r, DATE_KEYS);
    const descRaw = pick(r, DESC_KEYS) || "";
    const amtRaw = pick(r, AMT_KEYS);
    const srcRaw = pick(r, SRC_KEYS) || fallbackSource;
    const date = dateRaw ? parseDateLoose(dateRaw) : null;
    const amount = parseAmount(amtRaw ?? "");
    if (!date || amount === null) {
      if (Object.values(r).some(Boolean)) errors.push(`Linha ignorada: ${JSON.stringify(r)}`);
      continue;
    }
    // Preserva o sinal original (permite valores negativos em ambos os tipos).
    // O "type" segue o tipo padrão escolhido pelo usuário; o sinal vem do CSV.
    rows.push({
      occurred_on: date,
      description: String(descRaw).trim() || "Sem descrição",
      source: srcRaw?.toString().trim() || undefined,
      amount,
      competence: competenceFromDate(date),
      type: defaultType,
    });
  }

  return { rows, errors };
}
