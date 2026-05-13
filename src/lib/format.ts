export const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export const fmtMoney = (n: number) => BRL.format(n);

export const fmtDate = (d: string | Date) => {
  const date = typeof d === "string" ? new Date(d + "T00:00:00") : d;
  return date.toLocaleDateString("pt-BR");
};

export const competenceFromDate = (iso: string) => iso.slice(0, 7);

export const fmtCompetence = (yyyymm: string) => {
  const [y, m] = yyyymm.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
};

// Parse number strings like "1.234,56" or "1234.56" or "R$ 1.234,56"
export function parseAmount(raw: string | number | undefined | null): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return raw;
  let s = String(raw).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.includes("-");
  s = s.replace(/[^0-9.,-]/g, "");
  if (s.includes(",") && s.includes(".")) {
    // Brazilian: 1.234,56
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return negative ? -Math.abs(n) : n;
}

export function parseDateLoose(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // dd/mm/yyyy
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const [, dd, mm, yy] = m;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  // yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}
