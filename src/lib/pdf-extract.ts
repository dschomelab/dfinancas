// Client-side PDF text extraction using pdfjs-dist
import * as pdfjs from "pdfjs-dist";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - vite ?url import
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
}

export type PdfExtraction = {
  /** Texto completo concatenado de todas as páginas. */
  text: string;
  /** Linhas reconstituídas por agrupamento vertical (Y) — preserva ordem visual. */
  lines: string[];
  /** Número de páginas. */
  pages: number;
  /** Quantidade total de itens de texto encontrados. */
  textItems: number;
  /** true se o PDF parece ser apenas imagem (escaneado). */
  isScanned: boolean;
};

export async function extractPdf(file: File): Promise<PdfExtraction> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const allLines: string[] = [];
  let totalItems = 0;
  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    totalItems += content.items.length;

    // Agrupar itens por linha usando coordenada Y (transform[5]).
    // Tolerância de 2pt para variações.
    const byY = new Map<number, { x: number; str: string }[]>();
    for (const it of content.items) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const item = it as any;
      const str = typeof item.str === "string" ? item.str : "";
      if (!str.trim()) continue;
      const tr = item.transform as number[] | undefined;
      const x = tr ? tr[4] : 0;
      const yRaw = tr ? tr[5] : 0;
      const y = Math.round(yRaw / 2) * 2;
      const arr = byY.get(y) ?? [];
      arr.push({ x, str });
      byY.set(y, arr);
    }
    const ys = Array.from(byY.keys()).sort((a, b) => b - a); // top → bottom
    for (const y of ys) {
      const parts = byY.get(y)!.sort((a, b) => a.x - b.x).map((p) => p.str);
      const line = parts.join(" ").replace(/\s+/g, " ").trim();
      if (line) allLines.push(line);
    }
    fullText += content.items.map((it) => ("str" in it ? (it as { str: string }).str : "")).join(" ") + "\n";
  }

  const cleanText = fullText.replace(/\s+/g, " ").trim();
  // Heurística de PDF escaneado: poucas strings ou texto total muito curto.
  const isScanned = totalItems < 5 || cleanText.length < 40;

  return {
    text: fullText,
    lines: allLines,
    pages: pdf.numPages,
    textItems: totalItems,
    isScanned,
  };
}

/** Retrocompatibilidade — mantém a API antiga usada em outros lugares. */
export async function extractPdfText(file: File): Promise<string> {
  const r = await extractPdf(file);
  return r.text;
}
