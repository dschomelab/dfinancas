import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import Papa from "papaparse";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCategories, useGroups, useProfiles, useTransactionHistory, type HistoryEntry } from "@/lib/queries";
import { useAuth } from "@/lib/auth-context";
import { useServerFn } from "@tanstack/react-start";
import { extractTransactionsFromText } from "@/lib/ai-import.functions";
import { parseCsvText, inferSourceFromFilename, type ParsedRow } from "@/lib/csv-parser";
import { extractPdfText } from "@/lib/pdf-extract";
import { competenceFromDate, fmtDate, fmtMoney, parseAmount, parseDateLoose, normalizeCompetence } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, FileText, Sparkles, Trash2, History } from "lucide-react";

export const Route = createFileRoute("/_authenticated/import")({
  component: ImportPage,
});

function ImportPage() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="font-display text-3xl font-semibold">Importar arquivo</h1>
        <p className="text-sm text-muted-foreground">Use a importação mensal para fechamentos do mês ou a histórica para carga em lote de períodos antigos.</p>
      </div>
      <Tabs defaultValue="monthly" className="w-full">
        <TabsList>
          <TabsTrigger value="monthly"><FileText className="h-4 w-4 mr-2" />Mensal</TabsTrigger>
          <TabsTrigger value="historical"><History className="h-4 w-4 mr-2" />Histórico (lote)</TabsTrigger>
        </TabsList>
        <TabsContent value="monthly" className="mt-6"><MonthlyImport /></TabsContent>
        <TabsContent value="historical" className="mt-6"><HistoricalImport /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================== MENSAL ============================== */

type MonthlyRow = ParsedRow & { category_id?: string | null; grouped_description?: string; is_shared?: boolean };

function MonthlyImport() {
  const { user } = useAuth();
  const cats = useCategories();
  const groups = useGroups();
  const profiles = useProfiles();
  const qc = useQueryClient();
  const aiExtract = useServerFn(extractTransactionsFromText);
  const history = useTransactionHistory();

  const [defaultType, setDefaultType] = useState<"expense" | "income">("expense");
  const [competence, setCompetence] = useState<string>(new Date().toISOString().slice(0, 7));
  const [sharedGroupId, setSharedGroupId] = useState<string>("none");
  const [source, setSource] = useState("");
  const [rows, setRows] = useState<MonthlyRow[]>([]);
  const [subcategoryDrafts, setSubcategoryDrafts] = useState<Record<number, string>>({});
  const [filters, setFilters] = useState({ date: "", description: "", grouped: "", type: "all", category: "", subcategory: "", shared: "all" as "all" | "yes" | "no" });
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

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
    return (
      list.find((h) => h.type === type && normalizeDesc(h.description) === key) ||
      list.find((h) => h.type === type && normalizeDesc(h.description).includes(key)) ||
      list.find((h) => h.type === type && key.includes(normalizeDesc(h.description)))
    );
  };

  const applySuggestions = (r: MonthlyRow): MonthlyRow => {
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
        const mapped: MonthlyRow[] = (result.rows ?? []).map((r) => applySuggestions({
          occurred_on: r.occurred_on,
          description: r.description,
          source: r.source ?? source ?? inferred,
          amount: Number(r.amount),
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

  const updateRow = (i: number, patch: Partial<MonthlyRow>) => {
    setRows((rs) =>
      rs.map((r, idx) => {
        if (idx !== i) return r;
        const next = { ...r, ...patch };
        if (patch.type && patch.type !== r.type) next.category_id = null;
        if (patch.description !== undefined || patch.type !== undefined) {
          return applySuggestions(next);
        }
        return next;
      }),
    );
  };

  const remove = (i: number) => {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
    setSelected((s) => { const n = new Set<number>(); s.forEach((x) => { if (x < i) n.add(x); else if (x > i) n.add(x - 1); }); return n; });
  };

  const removeSelected = () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Remover ${selected.size} linha(s) selecionada(s) da pré-visualização?`)) return;
    setRows((rs) => rs.filter((_, idx) => !selected.has(idx)));
    setSelected(new Set());
  };

  const confirm = async () => {
    if (!user || rows.length === 0) return;
    if (!competence) return toast.error("Defina a competência da importação.");
    setBusy(true);
    const payload = rows.map((r) => ({
      user_id: user.id,
      attributed_to_user_id: user.id,
      attributed_to: profiles.data?.find((p) => p.id === user.id)?.display_name ?? user.email ?? null,
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
  const monthlyFilteredRows = rows.map((r, idx) => ({ r, idx })).filter(({ r }) => {
    const rowCats = allCats.filter((c) => c.type === r.type);
    const selectedCat = rowCats.find((c) => c.id === r.category_id);
    const category = (selectedCat?.parent ?? "").toLowerCase();
    const subcategory = (selectedCat?.name ?? "").toLowerCase();
    const isBlankFilter = (v: string) => v.trim().toLowerCase() === ":vazio";
    const matchFilter = (value: string, filterValue: string) => {
      if (!filterValue) return true;
      if (isBlankFilter(filterValue)) return !value.trim();
      return value.toLowerCase().includes(filterValue.toLowerCase());
    };
    return (
      (!filters.date || r.occurred_on.includes(filters.date)) &&
      matchFilter(r.description, filters.description) &&
      matchFilter(r.grouped_description ?? "", filters.grouped) &&
      (filters.type === "all" || r.type === filters.type) &&
      matchFilter(category, filters.category) &&
      matchFilter(subcategory, filters.subcategory) &&
      (filters.shared === "all" || (filters.shared === "yes" ? !!r.is_shared : !r.is_shared))
    );
  });

  return (
    <div className="space-y-6">
      <datalist id="grouped-suggestions">
        {groupedSuggestions.map((g) => <option key={g} value={g} />)}
      </datalist>
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
          <div className="p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              {filename.toLowerCase().endsWith(".pdf") ? <Sparkles className="h-4 w-4 text-accent" /> : <FileText className="h-4 w-4 text-accent" />}
              <span className="font-medium">{rows.length} lançamentos pré-visualizados</span>
              {selected.size > 0 && <span className="text-xs text-muted-foreground">· {selected.size} selecionado(s)</span>}
            </div>
            <div className="flex gap-2">
              {selected.size > 0 && (
                <Button variant="destructive" onClick={removeSelected} disabled={busy}>
                  <Trash2 className="h-4 w-4 mr-1" /> Excluir selecionados
                </Button>
              )}
              <Button onClick={confirm} disabled={busy}>{busy ? "Importando…" : "Confirmar importação"}</Button>
            </div>
          </div>
          <div className="overflow-auto border-t max-h-[70vh] scroll-always">
            <table className="w-full text-sm">
              <thead className="bg-white text-muted-foreground sticky top-0 z-20 shadow-sm">
                <tr>
                  <th className="text-center p-2 w-10">
                    <Checkbox
                      checked={monthlyFilteredRows.length > 0 && monthlyFilteredRows.every(({ idx }) => selected.has(idx))}
                      onCheckedChange={(v) => {
                        setSelected((s) => {
                          const n = new Set(s);
                          if (v) monthlyFilteredRows.forEach(({ idx }) => n.add(idx));
                          else monthlyFilteredRows.forEach(({ idx }) => n.delete(idx));
                          return n;
                        });
                      }}
                    />
                  </th>
                  <th className="text-left p-2">Data</th>
                  <th className="text-left p-2">Descrição</th>
                  <th className="text-left p-2">Descrição agrupada</th>
                  <th className="text-left p-2">Tipo</th>
                  <th className="text-left p-2">Categoria</th>
                  <th className="text-left p-2">Subcategoria</th>
                  <th className="text-center p-2">Compart.</th>
                  <th className="text-right p-2">Valor</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t bg-white sticky top-[41px] z-10">
                  <td></td>
                  <td className="p-2"><Input type="date" value={filters.date} onChange={(e) => setFilters((f) => ({ ...f, date: e.target.value }))} className="h-8 w-36" /></td>
                  <td className="p-2"><Input value={filters.description} onChange={(e) => setFilters((f) => ({ ...f, description: e.target.value }))} className="h-8 min-w-48" placeholder="Filtrar (:vazio)" /></td>
                  <td className="p-2"><Input value={filters.grouped} onChange={(e) => setFilters((f) => ({ ...f, grouped: e.target.value }))} className="h-8 min-w-40" placeholder="Filtrar (:vazio)" /></td>
                  <td className="p-2"><Select value={filters.type} onValueChange={(v) => setFilters((f) => ({ ...f, type: v }))}><SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="expense">Despesa</SelectItem><SelectItem value="income">Receita</SelectItem></SelectContent></Select></td>
                  <td className="p-2"><Input value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} className="h-8 min-w-32" placeholder="Filtrar (:vazio)" /></td>
                  <td className="p-2"><Input value={filters.subcategory} onChange={(e) => setFilters((f) => ({ ...f, subcategory: e.target.value }))} className="h-8 min-w-32" placeholder="Filtrar (:vazio)" /></td>
                  <td className="p-2"><Select value={filters.shared} onValueChange={(v) => setFilters((f) => ({ ...f, shared: v as "all" | "yes" | "no" }))}><SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="yes">Sim</SelectItem><SelectItem value="no">Não</SelectItem></SelectContent></Select></td>
                  <td></td><td></td>
                </tr>
                {monthlyFilteredRows.map(({ r, idx }) => {
                  const rowCats = allCats.filter((c) => c.type === r.type);
                  const selectedCat = rowCats.find((c) => c.id === r.category_id);
                  const subcategoryValue = subcategoryDrafts[idx] ?? selectedCat?.name ?? "";
                  return (
                    <tr key={idx} className="border-t align-top">
                      <td className="p-2 text-center">
                        <Checkbox checked={selected.has(idx)} onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(idx); else n.delete(idx); return n; })} />
                      </td>
                      <td className="p-2"><Input type="date" value={r.occurred_on} onChange={(e) => updateRow(idx, { occurred_on: e.target.value })} className="h-8 w-36" /></td>
                      <td className="p-2"><Input value={r.description} onChange={(e) => updateRow(idx, { description: e.target.value })} className="h-8 min-w-48" /></td>
                      <td className="p-2"><Input list="grouped-suggestions" value={r.grouped_description ?? ""} onChange={(e) => updateRow(idx, { grouped_description: e.target.value })} placeholder="Resumo" className="h-8 min-w-40" /></td>
                      <td className="p-2">
                        <Select value={r.type} onValueChange={(v) => updateRow(idx, { type: v as "expense" | "income" })}>
                          <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="expense">Despesa</SelectItem>
                            <SelectItem value="income">Receita</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2 text-muted-foreground min-w-32">
                        {selectedCat?.parent ?? "—"}
                      </td>
                      <td className="p-2">
                        <Input
                          list={`monthly-subcategory-${idx}`}
                          value={subcategoryValue}
                          onChange={(e) => {
                            setSubcategoryDrafts((s) => ({ ...s, [idx]: e.target.value }));
                            const match = rowCats.find((c) => c.name.toLowerCase() === e.target.value.toLowerCase().trim());
                            if (match) updateRow(idx, { category_id: match.id });
                          }}
                          onBlur={(e) => {
                            const match = rowCats.find((c) => c.name.toLowerCase() === e.target.value.toLowerCase().trim());
                            if (!match) {
                              updateRow(idx, { category_id: null });
                              setSubcategoryDrafts((s) => ({ ...s, [idx]: "" }));
                            }
                          }}
                          className="h-8 w-44"
                          placeholder="Digite subcategoria"
                        />
                        <datalist id={`monthly-subcategory-${idx}`}>
                          {rowCats.map((c) => <option key={c.id} value={c.name} />)}
                        </datalist>
                      </td>
                      <td className="p-2 text-center">
                        <Checkbox checked={!!r.is_shared} onCheckedChange={(v) => updateRow(idx, { is_shared: !!v })} />
                      </td>
                      <td className="p-2 w-32"><Input inputMode="decimal" value={String(r.amount)} onChange={(e) => updateRow(idx, { amount: parseFloat(e.target.value) || 0 })} className="h-8 text-right" /></td>
                      <td className="p-2 text-right">
                        <Button size="icon" variant="ghost" onClick={() => remove(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30">
                  <td></td>
                  <td className="p-2 font-medium" colSpan={7}>Totais</td>
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

/* ============================== HISTÓRICO (LOTE) ============================== */

type HistRow = {
  occurred_on: string;
  competence: string;
  description: string;
  grouped_description: string;
  amount: number;
  type: "expense" | "income";
  category_id: string | null;
  source: string;
  group_id: string | null;
  is_shared: boolean;
  attributed_to: string;
  _error?: string;
};

const HIST_HEADERS = [
  "data", "competencia", "descricao", "descricao_agrupada", "valor",
  "tipo", "categoria", "origem", "grupo", "compartilhado", "usuario",
];

function pickKey(row: Record<string, string>, candidates: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const k = keys.find((k) => k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() === c);
    if (k) return row[k];
  }
  return undefined;
}

function parseTipo(v: string | undefined): "expense" | "income" {
  const s = (v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (["receita", "income", "credito", "credit", "entrada", "+"].includes(s)) return "income";
  return "expense";
}
function parseBool(v: string | undefined): boolean {
  const s = (v || "").toLowerCase().trim();
  return ["sim", "true", "1", "yes", "y", "s"].includes(s);
}

function HistoricalImport() {
  const { user } = useAuth();
  const cats = useCategories();
  const groups = useGroups();
  const profiles = useProfiles();
  const qc = useQueryClient();
  const [rows, setRows] = useState<HistRow[]>([]);
  const [subcategoryDrafts, setSubcategoryDrafts] = useState<Record<number, string>>({});
  const [filters, setFilters] = useState({ date: "", competence: "", description: "", grouped: "", type: "all", category: "", subcategory: "", source: "", group: "", shared: "all" as "all" | "yes" | "no", user: "" });
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState("");

  const allCats = (cats.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const allGroups = groups.data ?? [];
  const allProfiles = profiles.data ?? [];
  const historicalFilteredRows = rows.map((r, idx) => ({ r, idx })).filter(({ r }) => {
    const rowCats = allCats.filter((c) => c.type === r.type);
    const selectedCat = rowCats.find((c) => c.id === r.category_id);
    const category = (selectedCat?.parent ?? "").toLowerCase();
    const subcategory = (selectedCat?.name ?? "").toLowerCase();
    const groupName = (allGroups.find((g) => g.id === r.group_id)?.name ?? "").toLowerCase();
    const isBlankFilter = (v: string) => v.trim().toLowerCase() === ":vazio";
    const matchFilter = (value: string, filterValue: string) => {
      if (!filterValue) return true;
      if (isBlankFilter(filterValue)) return !value.trim();
      return value.toLowerCase().includes(filterValue.toLowerCase());
    };
    return (
      (!filters.date || r.occurred_on.includes(filters.date)) &&
      matchFilter(r.competence, filters.competence) &&
      matchFilter(r.description, filters.description) &&
      matchFilter(r.grouped_description, filters.grouped) &&
      (filters.type === "all" || r.type === filters.type) &&
      matchFilter(category, filters.category) &&
      matchFilter(subcategory, filters.subcategory) &&
      matchFilter(r.source, filters.source) &&
      matchFilter(groupName, filters.group) &&
      (filters.shared === "all" || (filters.shared === "yes" ? !!r.is_shared : !r.is_shared)) &&
      matchFilter(r.attributed_to, filters.user)
    );
  });

  const findProfileId = (name: string | undefined): string | null => {
    if (!name) return null;
    const n = name.toLowerCase().trim();
    return allProfiles.find((p) => (p.display_name || "").toLowerCase().trim() === n || (p.email || "").toLowerCase().trim() === n)?.id ?? null;
  };

  const findCategoryId = (name: string | undefined, type: "expense" | "income"): string | null => {
    if (!name) return null;
    const n = name.toLowerCase().trim();
    return allCats.find((c) => c.type === type && c.name.toLowerCase() === n)?.id ?? null;
  };
  const findGroupId = (name: string | undefined): string | null => {
    if (!name) return null;
    const n = name.toLowerCase().trim();
    return allGroups.find((g) => g.name.toLowerCase() === n)?.id ?? null;
  };

  const onFile = async (file: File) => {
    setBusy(true);
    setFilename(file.name);
    try {
      const text = await file.text();
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true, skipEmptyLines: true, transformHeader: (h) => h.trim(),
      });
      const out: HistRow[] = [];
      for (const r of parsed.data) {
        if (!r || typeof r !== "object") continue;
        const dateRaw = pickKey(r, ["data", "date", "dt"]);
        const compRaw = pickKey(r, ["competencia", "competence", "mes", "mes/ano"]);
        const descRaw = pickKey(r, ["descricao", "description", "historico"]) || "";
        const grpDescRaw = pickKey(r, ["descricao_agrupada", "descricaoagrupada", "agrupada", "grouped_description"]) || "";
        const amtRaw = pickKey(r, ["valor", "amount", "value"]);
        const tipoRaw = pickKey(r, ["tipo", "type"]);
        const catRaw = pickKey(r, ["categoria", "category"]);
        const srcRaw = pickKey(r, ["origem", "source", "banco", "conta", "cartao"]);
        const grpRaw = pickKey(r, ["grupo", "group"]);
        const sharedRaw = pickKey(r, ["compartilhado", "shared", "compart"]);
        const userRaw = pickKey(r, ["usuario", "user", "responsavel", "atribuido"]);

        const occurred_on = dateRaw ? parseDateLoose(dateRaw) : null;
        const amount = parseAmount(amtRaw ?? "");
        if (!occurred_on || amount === null) continue;
        const type = parseTipo(tipoRaw);
        const competence = compRaw ? normalizeCompetence(compRaw) || competenceFromDate(occurred_on) : competenceFromDate(occurred_on);

        out.push({
          occurred_on,
          competence,
          description: String(descRaw).trim() || "Sem descrição",
          grouped_description: String(grpDescRaw).trim(),
          amount,
          type,
          category_id: findCategoryId(catRaw, type),
          source: (srcRaw || "").trim(),
          group_id: findGroupId(grpRaw),
          is_shared: parseBool(sharedRaw),
          attributed_to: (userRaw || "").trim(),
        });
      }
      setRows(out);
      toast.success(`${out.length} lançamentos lidos`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao ler CSV");
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (i: number, patch: Partial<HistRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch, ...(patch.type && patch.type !== r.type ? { category_id: null } : {}) } : r)));
  const remove = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const confirm = async () => {
    if (!user || rows.length === 0) return;
    setBusy(true);
    const payload = rows.map((r) => ({
      user_id: user.id,
      type: r.type,
      occurred_on: r.occurred_on,
      competence: r.competence,
      description: r.description,
      grouped_description: r.grouped_description?.trim() || null,
      source: r.source?.trim() || null,
      amount: r.amount,
      category_id: r.category_id || null,
      group_id: r.is_shared ? r.group_id : null,
      is_shared: !!r.is_shared,
      attributed_to: r.attributed_to?.trim() || null,
    }));
    const { error } = await supabase.from("transactions").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${payload.length} lançamentos importados!`);
    qc.invalidateQueries({ queryKey: ["transactions"] });
    setRows([]);
    setFilename("");
  };

  const downloadTemplate = () => {
    const csv = HIST_HEADERS.join(",") + "\n" +
      "2025-04-15,2025-04,Mercado Extra,Mercado mensal,350.50,despesa,Supermercado,Nubank,Casa,sim,Henrique\n" +
      "15/03/2025,03/2025,Salário Março,,8500,receita,Salário,Empresa X,,nao,Henrique\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "modelo_historico.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2">
            <h2 className="font-display text-xl font-semibold">Importação histórica em lote</h2>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Carregue um CSV com todos os campos no nível da linha. Colunas esperadas (em qualquer ordem):
              <br />
              <code className="text-xs">{HIST_HEADERS.join(", ")}</code>
            </p>
            <p className="text-xs text-muted-foreground">
              <strong>tipo</strong>: <em>despesa</em> ou <em>receita</em> · <strong>compartilhado</strong>: <em>sim/não</em> ·
              <strong> categoria</strong> e <strong>grupo</strong> são casados pelo nome (ignora maiúsculas) ·
              <strong> competencia</strong> aceita <em>YYYY-MM</em>, <em>MM/YYYY</em> ou data completa (sempre normalizada para o dia 01).
            </p>
          </div>
          <Button variant="outline" onClick={downloadTemplate}>Baixar modelo CSV</Button>
        </div>

        <label className="mt-6 flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-10 cursor-pointer hover:bg-muted/30 transition">
          <Upload className="h-8 w-8 text-primary" />
          <div className="font-medium">Selecione o CSV histórico</div>
          <div className="text-xs text-muted-foreground">{filename || "Nenhum arquivo selecionado"}</div>
          <input
            type="file"
            accept=".csv"
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
              <History className="h-4 w-4 text-accent" />
              <span className="font-medium">{rows.length} lançamentos pré-visualizados</span>
            </div>
            <Button onClick={confirm} disabled={busy}>{busy ? "Importando…" : "Confirmar importação"}</Button>
          </div>
          <div className="overflow-auto border-t max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="bg-white text-muted-foreground sticky top-0 z-20">
                <tr>
                  <th className="text-left p-2">Data</th>
                  <th className="text-left p-2">Competência</th>
                  <th className="text-left p-2">Descrição</th>
                  <th className="text-left p-2">Desc. agrupada</th>
                  <th className="text-left p-2">Tipo</th>
                  <th className="text-left p-2">Categoria</th>
                  <th className="text-left p-2">Subcategoria</th>
                  <th className="text-left p-2">Origem</th>
                  <th className="text-left p-2">Grupo</th>
                  <th className="text-center p-2">Compart.</th>
                  <th className="text-left p-2">Usuário</th>
                  <th className="text-right p-2">Valor</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t bg-white sticky top-[41px] z-10">
                  <td className="p-2"><Input type="date" value={filters.date} onChange={(e) => setFilters((f) => ({ ...f, date: e.target.value }))} className="h-8 w-36" /></td>
                  <td className="p-2"><Input value={filters.competence} onChange={(e) => setFilters((f) => ({ ...f, competence: e.target.value }))} className="h-8 w-32" placeholder="Filtrar (:vazio)" /></td>
                  <td className="p-2"><Input value={filters.description} onChange={(e) => setFilters((f) => ({ ...f, description: e.target.value }))} className="h-8 min-w-44" placeholder="Filtrar (:vazio)" /></td>
                  <td className="p-2"><Input value={filters.grouped} onChange={(e) => setFilters((f) => ({ ...f, grouped: e.target.value }))} className="h-8 min-w-36" placeholder="Filtrar (:vazio)" /></td>
                  <td className="p-2"><Select value={filters.type} onValueChange={(v) => setFilters((f) => ({ ...f, type: v }))}><SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="expense">Despesa</SelectItem><SelectItem value="income">Receita</SelectItem></SelectContent></Select></td>
                  <td className="p-2"><Input value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} className="h-8 w-32" placeholder="Filtrar (:vazio)" /></td>
                  <td className="p-2"><Input value={filters.subcategory} onChange={(e) => setFilters((f) => ({ ...f, subcategory: e.target.value }))} className="h-8 w-32" placeholder="Filtrar (:vazio)" /></td>
                  <td className="p-2"><Input value={filters.source} onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))} className="h-8 w-32" placeholder="Filtrar (:vazio)" /></td>
                  <td className="p-2"><Input value={filters.group} onChange={(e) => setFilters((f) => ({ ...f, group: e.target.value }))} className="h-8 w-32" placeholder="Filtrar (:vazio)" /></td>
                  <td className="p-2"><Select value={filters.shared} onValueChange={(v) => setFilters((f) => ({ ...f, shared: v as "all" | "yes" | "no" }))}><SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="yes">Sim</SelectItem><SelectItem value="no">Não</SelectItem></SelectContent></Select></td>
                  <td className="p-2"><Input value={filters.user} onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value }))} className="h-8 w-28" placeholder="Filtrar (:vazio)" /></td>
                  <td></td><td></td>
                </tr>
                {historicalFilteredRows.map(({ r, idx }) => {
                  const rowCats = allCats.filter((c) => c.type === r.type);
                  const selectedCat = rowCats.find((c) => c.id === r.category_id);
                  const subcategoryValue = subcategoryDrafts[idx] ?? selectedCat?.name ?? "";
                  return (
                    <tr key={idx} className="border-t align-top">
                      <td className="p-2"><Input type="date" value={r.occurred_on} onChange={(e) => updateRow(idx, { occurred_on: e.target.value })} className="h-8 w-36" /></td>
                      <td className="p-2"><Input value={r.competence} onChange={(e) => updateRow(idx, { competence: normalizeCompetence(e.target.value) || r.competence })} className="h-8 w-32" placeholder="Mai/2026" /></td>
                      <td className="p-2"><Input value={r.description} onChange={(e) => updateRow(idx, { description: e.target.value })} className="h-8 min-w-44" /></td>
                      <td className="p-2"><Input value={r.grouped_description} onChange={(e) => updateRow(idx, { grouped_description: e.target.value })} className="h-8 min-w-36" /></td>
                      <td className="p-2">
                        <Select value={r.type} onValueChange={(v) => updateRow(idx, { type: v as "expense" | "income" })}>
                          <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="expense">Despesa</SelectItem>
                            <SelectItem value="income">Receita</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2 text-muted-foreground min-w-32">
                        {selectedCat?.parent ?? "—"}
                      </td>
                      <td className="p-2">
                        <Input
                          list={`historical-subcategory-${idx}`}
                          value={subcategoryValue}
                          onChange={(e) => {
                            setSubcategoryDrafts((s) => ({ ...s, [idx]: e.target.value }));
                            const match = rowCats.find((c) => c.name.toLowerCase() === e.target.value.toLowerCase().trim());
                            if (match) updateRow(idx, { category_id: match.id });
                          }}
                          onBlur={(e) => {
                            const match = rowCats.find((c) => c.name.toLowerCase() === e.target.value.toLowerCase().trim());
                            if (!match) {
                              updateRow(idx, { category_id: null });
                              setSubcategoryDrafts((s) => ({ ...s, [idx]: "" }));
                            }
                          }}
                          className="h-8 w-44"
                          placeholder="Digite subcategoria"
                        />
                        <datalist id={`historical-subcategory-${idx}`}>
                          {rowCats.map((c) => <option key={c.id} value={c.name} />)}
                        </datalist>
                      </td>
                      <td className="p-2"><Input value={r.source} onChange={(e) => updateRow(idx, { source: e.target.value })} className="h-8 min-w-32" /></td>
                      <td className="p-2">
                        <Select value={r.group_id ?? "none"} onValueChange={(v) => updateRow(idx, { group_id: v === "none" ? null : v })}>
                          <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Sem grupo" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sem grupo</SelectItem>
                            {allGroups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2 text-center">
                        <Checkbox checked={!!r.is_shared} onCheckedChange={(v) => updateRow(idx, { is_shared: !!v })} />
                      </td>
                      <td className="p-2"><Input value={r.attributed_to} onChange={(e) => updateRow(idx, { attributed_to: e.target.value })} placeholder="Nome" className="h-8 min-w-28" /></td>
                      <td className="p-2 w-32"><Input inputMode="decimal" value={String(r.amount)} onChange={(e) => updateRow(idx, { amount: parseFloat(e.target.value) || 0 })} className="h-8 text-right" /></td>
                      <td className="p-2 text-right">
                        <Button size="icon" variant="ghost" onClick={() => remove(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30">
                  <td className="p-2 font-medium" colSpan={11}>Totais</td>
                  <td className="p-2 text-right font-medium">{fmtMoney(rows.reduce((a, b) => a + b.amount, 0))}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
