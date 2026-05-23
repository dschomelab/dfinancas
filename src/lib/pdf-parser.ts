/**
 * Parser determinístico de extratos/faturas em PDF.
 *
 * Estratégia:
 *  1. Detectar ano de referência a partir do cabeçalho do documento
 *     ("Emitido em", "Data:", "Vencimento:", "Vence em", "Fechamento", etc.).
 *  2. Varrer linhas e extrair tuplas (data, descrição, valor) usando regex
 *     tolerantes a múltiplos layouts (Bradesco, Mercado Pago, etc.).
 *  3. Inferir o ano de cada linha (datas DD/MM) com base no mês de referência:
 *     mês > mês_ref → ano anterior; senão → ano de referência.
 *  4. Calcular score de confiança (linhas válidas / linhas candidatas).
 *
 * Sem dependência de IA. IA é fallback acionado pelo chamador.
 */

import { competenceFromDate, parseAmount } from "./format";

export type DeterministicRow = {
  occurred_on: string; // YYYY-MM-DD
  description: string;
  amount: number; // sinal preservado
  type: "expense" | "income";
  source?: string;
  competence: string; // YYYY-MM
  installment?: string; // ex: "3/12"
};

export type DeterministicResult = {
  rows: DeterministicRow[];
  confidence: number; // 0..1
  parser: string; // nome do parser usado
  candidateLines: number;
  acceptedLines: number;
  rejectedSamples: string[]; // amostras (até 10) de linhas que pareciam transação mas falharam
  refYear: number;
  refMonth: number; // 1..12
  notes: string[];
};

// ---------- helpers ----------

// Aceita "R$ 1.234,56", "-R$ 1.234,56", "−R$ 1.234,56" (minus unicode), "(R$ 1,00)"
const MONEY_RE = /([\u2212-]?\s*R?\$?\s*[\u2212-]?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
const DATE_DDMM = /^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?\s+(.*)$/;

// Formato Nubank: "28 MAR" (DD MES_PT) opcionalmente seguido de cartão "•••• 7458"
const MONTHS_PT: Record<string, number> = {
  JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6,
  JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12,
};
const DATE_DDMES =
  /^(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)(?:\s+\d{4})?\s+(.*)$/i;
const CARD_MASK = /^(?:[•·●\u2022\u00b7*]{2,}\s*\d{3,4}|x{2,}\s*\d{3,4})\s+/i;

// Termos típicos de cabeçalho / sumário a ignorar (não são lançamentos):
const SKIP_PATTERNS: RegExp[] = [
  /^total\b/i,
  /^subtotal\b/i,
  /saldo anterior/i,
  /^limite\b/i,
  /^saque (utilizado|disponível|disponivel)/i,
  /^próximo fechamento|^proximo fechamento/i,
  /^fechamento da fatura/i,
  /^melhor dia/i,
  /^vencimento\b/i,
  /^cotação|^cotacao/i,
  /^juros do/i,
  /^iof\b/i,
  /^cet\b/i,
  /^pagamento (mínimo|minimo|total|em atraso)/i,
  /^parcelamento de fatura/i,
  /^opções de pagamento|^opcoes de pagamento/i,
  /^consumos de /i,
  /^tarifas e encargos/i,
  /^multas por atraso/i,
  /^pagamentos e créditos|^pagamentos e creditos/i,
  /^total da fatura/i,
  /^total para /i,
  /^até \d+ \+ \d+x/i,
  /^ate \d+ \+ \d+x/i,
  /^1 \+ \d+x/i,
];

// ---------- ano de referência ----------

function detectRefDate(text: string): { year: number; month: number } {
  const now = new Date();
  let bestYear = now.getFullYear();
  let bestMonth = now.getMonth() + 1;
  let found = false;

  // Procura datas DD/MM/AAAA em rótulos comuns
  const patterns = [
    /(?:emitido em|data|vencimento|vence em|fechamento(?: da fatura)?|próximo fechamento|proximo fechamento|melhor dia(?: de compra)?)[:\s]+(\d{2})\/(\d{2})\/(\d{4})/gi,
    /(\d{2})\/(\d{2})\/(\d{4})/g,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const mm = parseInt(m[2], 10);
      const yy = parseInt(m[3], 10);
      if (yy >= 2000 && yy <= 2100 && mm >= 1 && mm <= 12) {
        if (!found || yy > bestYear || (yy === bestYear && mm > bestMonth)) {
          bestYear = yy;
          bestMonth = mm;
          found = true;
        }
      }
    }
    if (found) break;
  }

  return { year: bestYear, month: bestMonth };
}

function inferYear(month: number, refYear: number, refMonth: number): number {
  // Se o mês da linha está à frente do mês de referência, é do ano anterior.
  return month > refMonth ? refYear - 1 : refYear;
}

function cleanDescription(raw: string): { desc: string; installment?: string } {
  let s = raw.replace(/\s+/g, " ").trim();
  let installment: string | undefined;

  // "Parcela 3 de 12"
  let m = s.match(/parcela\s+(\d{1,2})\s+de\s+(\d{1,2})/i);
  if (m) {
    installment = `${m[1]}/${m[2]}`;
    s = s.replace(m[0], "").trim();
  } else {
    // "3/12" embutido ao final
    m = s.match(/\b(\d{1,2})\/(\d{1,2})\b\s*$/);
    if (m && parseInt(m[2], 10) >= 2 && parseInt(m[2], 10) <= 36) {
      installment = `${m[1]}/${m[2]}`;
      s = s.slice(0, m.index).trim();
    }
  }
  // remove "R$" residual
  s = s.replace(/\bR\$\s*$/i, "").trim();
  return { desc: s || "Sem descrição", installment };
}

// ---------- parser principal ----------

export function parsePdfDeterministic(
  lines: string[],
  defaultType: "expense" | "income",
  fallbackSource?: string,
): DeterministicResult {
  const fullText = lines.join("\n");
  const { year: refYear, month: refMonth } = detectRefDate(fullText);
  const notes: string[] = [`Ano/Mês de referência detectado: ${String(refMonth).padStart(2, "0")}/${refYear}`];

  const rows: DeterministicRow[] = [];
  const rejected: string[] = [];
  let candidates = 0;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;

    // candidato = começa com DD/MM ou "DD MES" (Nubank)
    let dd: number, mm: number;
    let explicitYear: string | undefined;
    let rest: string;
    const m1 = line.match(DATE_DDMM);
    const m2 = !m1 ? line.match(DATE_DDMES) : null;
    if (m1) {
      dd = parseInt(m1[1], 10);
      mm = parseInt(m1[2], 10);
      explicitYear = m1[3];
      rest = m1[4];
    } else if (m2) {
      dd = parseInt(m2[1], 10);
      mm = MONTHS_PT[m2[2].toUpperCase()];
      rest = m2[3];
    } else {
      continue;
    }
    candidates++;

    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) {
      rejected.push(line);
      continue;
    }

    // Remove prefixo de máscara de cartão "•••• 7458 " (Nubank)
    rest = rest.replace(CARD_MASK, "").trim();


    // valor no final da linha
    const moneyMatch = rest.match(MONEY_RE);
    if (!moneyMatch) {
      if (rejected.length < 10) rejected.push(line);
      continue;
    }
    const moneyRaw = moneyMatch[1];
    const amount = parseAmount(moneyRaw);
    if (amount === null) {
      if (rejected.length < 10) rejected.push(line);
      continue;
    }

    const descRaw = rest.slice(0, rest.length - moneyMatch[0].length).trim();

    // skip linhas de resumo / cabeçalho
    if (SKIP_PATTERNS.some((re) => re.test(descRaw)) || SKIP_PATTERNS.some((re) => re.test(line))) {
      continue;
    }
    if (!descRaw) {
      if (rejected.length < 10) rejected.push(line);
      continue;
    }

    const year = explicitYear
      ? explicitYear.length === 2
        ? 2000 + parseInt(explicitYear, 10)
        : parseInt(explicitYear, 10)
      : inferYear(mm, refYear, refMonth);

    const occurred_on = `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    const { desc, installment } = cleanDescription(descRaw);

    // Tipo: respeita o padrão; sinal vem do valor (negativo = devolução/pagamento)
    rows.push({
      occurred_on,
      description: desc,
      amount,
      type: defaultType,
      source: fallbackSource,
      competence: competenceFromDate(occurred_on),
      installment,
    });
  }

  const confidence = candidates === 0 ? 0 : Math.min(1, rows.length / candidates);

  return {
    rows,
    confidence,
    parser: "generic-statement-v1",
    candidateLines: candidates,
    acceptedLines: rows.length,
    rejectedSamples: rejected.slice(0, 10),
    refYear,
    refMonth,
    notes,
  };
}
