import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCategories, useGroups } from "@/lib/queries";
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

type Row = ParsedRow & { category_id?: string | null };

function ImportPage() {
  const { user } = useAuth();
  const cats = useCategories();
  const groups = useGroups();
  const qc = useQueryClient();
  const aiExtract = useServerFn(extractTransactionsFromText);

  const [defaultType, setDefaultType] = useState<"expense" | "income">("expense");
  const [groupId, setGroupId] = useState<string>("none");
  const [source, setSource] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState("");

  const onFile = async (file: File) => {
    setBusy(true);
    setFilename(file.name);
    const inferred = inferSourceFromFilename(file.name);
    if (!source) setSource(inferred);
    try {
      if (file.name.toLowerCase().endsWith(".csv")) {
        const text = await file.text();
        const parsed = parseCsvText(text, defaultType, source || inferred);
        setRows(parsed.rows.map((r) => ({ ...r, category_id: null })));
        toast.success(`${parsed.rows.length} lançamentos lidos do CSV`);
        if (parsed.errors.length) console.warn(parsed.errors);
      } else if (file.name.toLowerCase().endsWith(".pdf")) {
        toast.info("Lendo PDF e extraindo com IA…");
        const text = await extractPdfText(file);
        const result = await aiExtract({ data: { text, defaultType, hint: source || inferred } });
        const mapped: Row[] = (result.rows ?? []).map((r) => ({
          occurred_on: r.occurred_on,
          description: r.description,
          source: r.source ?? source ?? inferred,
          amount: Math.abs(Number(r.amount)),
          competence: competenceFromDate(r.occurred_on),
          type: r.type,
          category_id: null,
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
        // Se mudou a data e a competência ainda não foi tocada manualmente, sincroniza
        if (patch.occurred_on && !patch.competence) {
          next.competence = competenceFromDate(patch.occurred_on);
        }
        // Se mudou o tipo, limpa categoria (categorias são por tipo)
        if (patch.type && patch.type !== r.type) next.category_id = null;
        return next;
      }),
    );
  };

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
      source: r.source ?? null,
      amount: r.amount,
      category_id: r.category_id || null,
      group_id: groupId === "none" ? null : groupId,
      is_shared: groupId !== "none",
    }));
    const { error } = await supabase.from("transactions").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${payload.length} lançamentos importados!`);
    qc.invalidateQueries({ queryKey: ["transactions"] });
    setRows([]);
    setFilename("");
  };

  const allCats = cats.data ?? [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="font-display text-3xl font-semibold">Importar arquivo</h1>
        <p className="text-sm text-muted-foreground">CSV é lido localmente. PDF é interpretado por IA. Edite categoria e competência linha a linha antes de confirmar.</p>
      </div>

      <Card className="p-6">
        <div className="grid md:grid-cols-3 gap-4">
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
            <Label>Grupo (opcional)</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger><SelectValue placeholder="Pessoal" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Pessoal</SelectItem>
                {(groups.data ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Origem (banco/cartão)</Label>
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Detectado do nome" />
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
                  <th className="text-left p-2">Competência</th>
                  <th className="text-left p-2">Descrição</th>
                  <th className="text-left p-2">Tipo</th>
                  <th className="text-left p-2">Categoria</th>
                  <th className="text-left p-2">Origem</th>
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
                      <td className="p-2"><Input type="month" value={r.competence} onChange={(e) => updateRow(i, { competence: e.target.value })} className="h-8 w-32" /></td>
                      <td className="p-2"><Input value={r.description} onChange={(e) => updateRow(i, { description: e.target.value })} className="h-8 min-w-48" /></td>
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
                      <td className="p-2"><Input value={r.source ?? ""} onChange={(e) => updateRow(i, { source: e.target.value })} className="h-8 w-32" /></td>
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
