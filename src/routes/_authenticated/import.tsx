import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCategories, useGroups, useTransactionHistory, type HistoryEntry } from "@/lib/queries";
import { useAuth } from "@/lib/auth-context";
import { useServerFn } from "@tanstack/react-start";
import { extractTransactionsFromText } from "@/lib/ai-import.functions";
import { parseCsvText, inferSourceFromFilename, type ParsedRow } from "@/lib/csv-parser";
import { extractPdfText } from "@/lib/pdf-extract";
import { competenceFromDate, fmtDate, fmtMoney } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, FileText, Sparkles, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/import")({
  component: ImportPage,
});

type Row = ParsedRow & { category_id?: string | null; grouped_description?: string; is_shared?: boolean };

function ImportPage() {
  const { user } = useAuth();
  const cats = useCategories();
  const groups = useGroups();
  const qc = useQueryClient();
  const aiExtract = useServerFn(extractTransactionsFromText);
  const history = useTransactionHistory();

  const [defaultType, setDefaultType] = useState<"expense" | "income">("expense");
  const [competence, setCompetence] = useState<string>(new Date().toISOString().slice(0, 7));
  const [sharedGroupId, setSharedGroupId] = useState<string>("none");
  const [source, setSource] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState("");

  // Normaliza descrição removendo parcelas (1/12, 02 de 12, parc 3-12), espaços e acentos
  const normalizeDesc = (s: string) =>
    (s || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\b(\d{1,3})\s*(?:\/|de|-)\s*(\d{1,3})\b/g, "")
      .replace(/\bparc(?:ela)?\.?\s*\d+/g, "")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const findHistoryMatch = (desc: string, type: "expense" | "income"): HistoryEntry | undefined => {
    const key = normalizeDesc(desc);
    if (!key || key.length < 3) return undefined;
    const list = history.data ?? [];
    // exato primeiro, depois prefixo/contém
    return (
      list.find((h) => h.type === type && normalizeDesc(h.description) === key) ||
      list.find((h) => h.type === type && normalizeDesc(h.description).includes(key)) ||
      list.find((h) => h.type === type && key.includes(normalizeDesc(h.description)))
    );
  };

  const applySuggestions = (r: Row): Row => {
    const m = findHistoryMatch(r.description, r.type);
    if (!m) return r;
    return {
      ...r,
      grouped_description: r.grouped_description || m.grouped_description || "",
      category_id: r.category_id || m.category_id || null,
      is_shared: r.is_shared ?? m.is_shared,
    };
  };

  const groupedSuggestions = Array.from(
    new Set(((history.data ?? []).map((h) => h.grouped_description).filter(Boolean) as string[])),
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const onFile = async (file: File) => {
    setBusy(true);
    setFilename(file.name);
    const inferred = inferSourceFromFilename(file.name);
    if (!source) setSource(inferred);
    try {
      if (file.name.toLowerCase().endsWith(".csv")) {
        const text = await file.text();
        const parsed = parseCsvText(text, defaultType, source || inferred);
        setRows(parsed.rows.map((r) => applySuggestions({ ...r, competence, category_id: null, grouped_description: "", is_shared: false })));
        toast.success(`${parsed.rows.length} lançamentos lidos do CSV`);
        if (parsed.errors.length) console.warn(parsed.errors);
      } else if (file.name.toLowerCase().endsWith(".pdf")) {
        toast.info("Lendo PDF e extraindo com IA…");
        const text = await extractPdfText(file);
        const result = await aiExtract({ data: { text, defaultType, hint: source || inferred } });
        const mapped: Row[] = (result.rows ?? []).map((r) => applySuggestions({
          occurred_on: r.occurred_on,
          description: r.description,
          source: r.source ?? source ?? inferred,
          amount: Math.abs(Number(r.amount)),
          competence,
          type: r.type,
          category_id: null,
          grouped_description: "",
          is_shared: false,
        }));
        setRows(mapped);
        toast.success(`${mapped.length} lançamentos extraídos pela IA`);
      } else {
        toast.error("Formato não suportado. Use CSV ou PDF.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao processar arquivo");
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (i: number, patch: Partial<Row>) => {
    setRows((rs) =>
      rs.map((r, idx) => {
        if (idx !== i) return r;
        const next = { ...r, ...patch };
        if (patch.type && patch.type !== r.type) next.category_id = null;
        // Reaplica sugestões quando a descrição ou o tipo mudam
        if (patch.description !== undefined || patch.type !== undefined) {
          return applySuggestions(next);
        }
        return next;
      }),
    );
  };

  const remove = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const confirm = async () => {
    if (!user || rows.length === 0) return;
    if (!competence) return toast.error("Defina a competência da importação.");
    setBusy(true);
    const payload = rows.map((r) => ({
      user_id: user.id,
      type: r.type,
      occurred_on: r.occurred_on,
      competence,
      description: r.description,
      grouped_description: r.grouped_description?.trim() || null,
      source: source?.trim() || r.source || null,
      amount: r.amount,
      category_id: r.category_id || null,
      group_id: r.is_shared && sharedGroupId !== "none" ? sharedGroupId : null,
      is_shared: !!r.is_shared,
    }));
    const { error } = await supabase.from("transactions").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${payload.length} lançamentos importados!`);
    qc.invalidateQueries({ queryKey: ["transactions"] });
    setRows([]);
    setFilename("");
  };

  const allCats = (cats.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="font-display text-3xl font-semibold">Importar arquivo</h1>
        <p className="text-sm text-muted-foreground">CSV é lido localmente. PDF é interpretado por IA. Defina competência, origem e grupo padrão; marque a coluna "Compartilhado" linha a linha.</p>
      </div>

      <Card className="p-6">
        <div className="grid md:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label>Tipo padrão</Label>
            <Select value={defaultType} onValueChange={(v) => setDefaultType(v as "expense" | "income")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Despesa</SelectItem>
                <SelectItem value="income">Receita</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Competência</Label>
            <Input type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Origem (banco/cartão)</Label>
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Detectado do nome" />
          </div>
          <div className="space-y-1.5">
            <Label>Grupo p/ compartilhados</Label>
            <Select value={sharedGroupId} onValueChange={setSharedGroupId}>
              <SelectTrigger><SelectValue placeholder="Pessoal" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem grupo</SelectItem>
                {(groups.data ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <label className="mt-6 flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-10 cursor-pointer hover:bg-muted/30 transition">
          <Upload className="h-8 w-8 text-primary" />
          <div className="font-medium">Selecione um arquivo CSV ou PDF</div>
          <div className="text-xs text-muted-foreground">{filename || "Nenhum arquivo selecionado"}</div>
          <input
            type="file"
            accept=".csv,.pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            disabled={busy}
          />
        </label>
      </Card>

      {rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {filename.toLowerCase().endsWith(".pdf") ? <Sparkles className="h-4 w-4 text-accent" /> : <FileText className="h-4 w-4 text-accent" />}
              <span className="font-medium">{rows.length} lançamentos pré-visualizados</span>
            </div>
            <Button onClick={confirm} disabled={busy}>{busy ? "Importando…" : "Confirmar importação"}</Button>
          </div>
          <div className="overflow-x-auto border-t">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left p-2">Data</th>
                  <th className="text-left p-2">Descrição</th>
                  <th className="text-left p-2">Descrição agrupada</th>
                  <th className="text-left p-2">Tipo</th>
                  <th className="text-left p-2">Categoria</th>
                  <th className="text-center p-2">Compart.</th>
                  <th className="text-right p-2">Valor</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const rowCats = allCats.filter((c) => c.type === r.type);
                  return (
                    <tr key={i} className="border-t align-top">
                      <td className="p-2"><Input type="date" value={r.occurred_on} onChange={(e) => updateRow(i, { occurred_on: e.target.value })} className="h-8 w-36" /></td>
                      <td className="p-2"><Input value={r.description} onChange={(e) => updateRow(i, { description: e.target.value })} className="h-8 min-w-48" /></td>
                      <td className="p-2"><Input value={r.grouped_description ?? ""} onChange={(e) => updateRow(i, { grouped_description: e.target.value })} placeholder="Resumo" className="h-8 min-w-40" /></td>
                      <td className="p-2">
                        <Select value={r.type} onValueChange={(v) => updateRow(i, { type: v as "expense" | "income" })}>
                          <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="expense">Despesa</SelectItem>
                            <SelectItem value="income">Receita</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2">
                        <Select value={r.category_id ?? "none"} onValueChange={(v) => updateRow(i, { category_id: v === "none" ? null : v })}>
                          <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Sem categoria" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sem categoria</SelectItem>
                            {rowCats.map((c) => <SelectItem key={c.id} value={c.id}>{c.parent ? `${c.parent} · ${c.name}` : c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2 text-center">
                        <Checkbox checked={!!r.is_shared} onCheckedChange={(v) => updateRow(i, { is_shared: !!v })} />
                      </td>
                      <td className="p-2 w-32"><Input inputMode="decimal" value={String(r.amount)} onChange={(e) => updateRow(i, { amount: parseFloat(e.target.value) || 0 })} className="h-8 text-right" /></td>
                      <td className="p-2 text-right">
                        <Button size="icon" variant="ghost" onClick={() => remove(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30">
                  <td className="p-2 font-medium" colSpan={6}>Totais</td>
                  <td className="p-2 text-right font-medium">{fmtMoney(rows.reduce((a, b) => a + b.amount, 0))}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground">{fmtDate(new Date())} · Dica: o nome do arquivo é usado como origem padrão (ex.: <em>nubank_2025-04.csv</em>).</p>
      )}
    </div>
  );
}
