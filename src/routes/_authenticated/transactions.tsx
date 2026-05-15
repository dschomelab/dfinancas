import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTransactions, useCategories, useGroups, useProfiles, type Transaction } from "@/lib/queries";
import { fmtMoney, fmtDate, fmtCompetence } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { CalendarRange, ChevronDown } from "lucide-react";
import { TransactionDialog } from "@/components/transaction-dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/transactions")({
  component: TransactionsPage,
});

function competencesAround() {
  const out: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function TransactionsPage() {
  const months = useMemo(competencesAround, []);
  const current = months[months.length - 1];
  const [selectedComps, setSelectedComps] = useState<string[]>([current]);
  const [type, setType] = useState<"all" | "expense" | "income">("all");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [sharedFilter, setSharedFilter] = useState<"all" | "shared" | "personal">("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const cats = useCategories();
  const groups = useGroups();
  const profiles = useProfiles();
  const tx = useTransactions({ competences: selectedComps, type, categoryId: catFilter, groupId: groupFilter, shared: sharedFilter });
  const qc = useQueryClient();

  const sortedCats = useMemo(
    () => (cats.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [cats.data],
  );

  const remove = async (id: string) => {
    if (!confirm("Excluir este lançamento?")) return;
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Excluído");
    qc.invalidateQueries({ queryKey: ["transactions"] });
    setSelectedIds((s) => s.filter((x) => x !== id));
  };

  const removeMany = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Excluir ${selectedIds.length} lançamento(s) selecionado(s)?`)) return;
    const { error } = await supabase.from("transactions").delete().in("id", selectedIds);
    if (error) return toast.error(error.message);
    toast.success(`${selectedIds.length} lançamento(s) excluído(s)`);
    setSelectedIds([]);
    qc.invalidateQueries({ queryKey: ["transactions"] });
  };

  const toggleShared = async (t: Transaction, value: boolean) => {
    const { error } = await supabase.from("transactions").update({ is_shared: value }).eq("id", t.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["transactions"] });
  };

  const idsInView = (tx.data ?? []).map((t) => t.id);
  const allInViewSelected = idsInView.length > 0 && idsInView.every((id) => selectedIds.includes(id));

  const toggleSelectAllInView = (checked: boolean) => {
    if (!checked) {
      setSelectedIds((prev) => prev.filter((id) => !idsInView.includes(id)));
      return;
    }
    setSelectedIds((prev) => Array.from(new Set([...prev, ...idsInView])));
  };

  const toggleSelectRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => (checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id)));
  };

  const toggleComp = (m: string) => {
    setSelectedComps((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));
  };

  const selectedCompLabel = selectedComps.length === 0
    ? "Nenhuma competência"
    : selectedComps.length === 1
      ? fmtCompetence(selectedComps[0])
      : `${selectedComps.length} competências`;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Lançamentos</h1>
          <p className="text-sm text-muted-foreground">Filtre por competência, tipo, categoria, grupo ou compartilhamento.</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Novo
        </Button>
      </div>

      {selectedIds.length > 0 && (
        <Card className="p-3 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{selectedIds.length} lançamento(s) selecionado(s)</p>
          <Button variant="destructive" onClick={removeMany}>
            <Trash2 className="h-4 w-4 mr-1" /> Excluir selecionados
          </Button>
        </Card>
      )}

      <Card className="p-4">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-64 justify-between capitalize">
              <span className="flex items-center gap-2"><CalendarRange className="h-4 w-4" />{selectedCompLabel}</span>
              <ChevronDown className="h-4 w-4 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2 max-h-80 overflow-auto">
            <div className="flex justify-between px-2 py-1 text-xs text-muted-foreground">
              <button className="hover:underline" onClick={() => setSelectedComps(months)}>Selecionar tudo</button>
              <button className="hover:underline" onClick={() => setSelectedComps([])}>Limpar</button>
            </div>
            <div className="space-y-1">
              {months.slice().reverse().map((m) => (
                <label key={m} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer">
                  <Checkbox checked={selectedComps.includes(m)} onCheckedChange={() => toggleComp(m)} />
                  <span className="capitalize text-sm">{fmtCompetence(m)}</span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </Card>

      <Card className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Select value={type} onValueChange={(v) => setType(v as "all" | "expense" | "income")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="expense">Despesas</SelectItem>
            <SelectItem value="income">Receitas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            {sortedCats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os grupos</SelectItem>
            {(groups.data ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sharedFilter} onValueChange={(v) => setSharedFilter(v as "all" | "shared" | "personal")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Compart. + pessoais</SelectItem>
            <SelectItem value="shared">Apenas compartilhados</SelectItem>
            <SelectItem value="personal">Apenas pessoais</SelectItem>
          </SelectContent>
        </Select>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left p-3">Data</th>
                <th className="text-center p-3 w-12">
                  <Checkbox checked={allInViewSelected} onCheckedChange={(v) => toggleSelectAllInView(!!v)} />
                </th>
                <th className="text-left p-3">Descrição</th>
                <th className="text-left p-3">Descrição agrupada</th>
                <th className="text-left p-3">Categoria</th>
                <th className="text-left p-3">Subcategoria</th>
                <th className="text-left p-3">Responsável</th>
                <th className="text-left p-3">Origem</th>
                <th className="text-center p-3">Compart.</th>
                <th className="text-right p-3">Valor</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {(tx.data ?? []).map((t) => {
                const cat = sortedCats.find((c) => c.id === t.category_id);
                const parentCategory = cat?.parent ?? "—";
                const subCategory = cat?.parent ? cat.name : "—";
                return (
                  <tr key={t.id} className="border-t hover:bg-muted/30">
                    <td className="p-3 whitespace-nowrap">{fmtDate(t.occurred_on)}</td>
                    <td className="p-3 text-center">
                      <Checkbox checked={selectedIds.includes(t.id)} onCheckedChange={(v) => toggleSelectRow(t.id, !!v)} />
                    </td>
                    <td className="p-3">
                      <div className="font-medium">{t.description}</div>
                      <div className="flex gap-1 mt-1">
                        {t.group_id && <Badge variant="outline" className="text-[10px]">{groups.data?.find((g) => g.id === t.group_id)?.name}</Badge>}
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">{t.grouped_description ?? <span className="text-muted-foreground/60">—</span>}</td>
                    <td className="p-3">{cat ? parentCategory : <span className="text-muted-foreground">—</span>}</td>
                    <td className="p-3">{cat ? subCategory : <span className="text-muted-foreground">—</span>}</td>
                    <td className="p-3 text-muted-foreground">
                      {profiles.data?.find((p) => p.id === t.attributed_to_user_id)?.display_name
                        || profiles.data?.find((p) => p.id === t.attributed_to_user_id)?.email
                        || t.attributed_to
                        || <span className="text-muted-foreground/60">—</span>}
                    </td>
                    <td className="p-3 text-muted-foreground">{t.source ?? "—"}</td>
                    <td className="p-3 text-center">
                      <Checkbox checked={t.is_shared} onCheckedChange={(v) => toggleShared(t, !!v)} />
                    </td>
                    <td className={`p-3 text-right font-medium ${t.type === "expense" ? "text-destructive" : "text-success"}`}>
                      {t.type === "expense" ? "-" : "+"}{fmtMoney(Number(t.amount))}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <Button size="icon" variant="ghost" onClick={() => { setEditing(t); setOpen(true); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(t.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {(tx.data ?? []).length === 0 && (
                <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">Nenhum lançamento neste filtro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <TransactionDialog open={open} onOpenChange={setOpen} initial={editing} />
    </div>
  );
}
