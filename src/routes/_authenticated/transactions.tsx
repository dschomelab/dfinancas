import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTransactions, useCategories, useGroups, type Transaction } from "@/lib/queries";
import { fmtMoney, fmtDate, fmtCompetence } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2 } from "lucide-react";
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
  const [comp, setComp] = useState(months[months.length - 1]);
  const [type, setType] = useState<"all" | "expense" | "income">("all");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const cats = useCategories();
  const groups = useGroups();
  const tx = useTransactions({ competence: comp, type, categoryId: catFilter, groupId: groupFilter });
  const qc = useQueryClient();

  const remove = async (id: string) => {
    if (!confirm("Excluir este lançamento?")) return;
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Excluído");
    qc.invalidateQueries({ queryKey: ["transactions"] });
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Lançamentos</h1>
          <p className="text-sm text-muted-foreground">Filtre por competência, tipo, categoria ou grupo.</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Novo
        </Button>
      </div>

      <Card className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Select value={comp} onValueChange={setComp}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {months.map((m) => <SelectItem key={m} value={m} className="capitalize">{fmtCompetence(m)}</SelectItem>)}
          </SelectContent>
        </Select>
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
            {(cats.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os grupos</SelectItem>
            {(groups.data ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left p-3">Data</th>
                <th className="text-left p-3">Descrição</th>
                <th className="text-left p-3">Categoria</th>
                <th className="text-left p-3">Origem</th>
                <th className="text-right p-3">Valor</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {(tx.data ?? []).map((t) => {
                const cat = cats.data?.find((c) => c.id === t.category_id);
                return (
                  <tr key={t.id} className="border-t hover:bg-muted/30">
                    <td className="p-3 whitespace-nowrap">{fmtDate(t.occurred_on)}</td>
                    <td className="p-3">
                      <div className="font-medium">{t.description}</div>
                      <div className="flex gap-1 mt-1">
                        {t.is_shared && <Badge variant="secondary" className="text-[10px]">Compartilhada</Badge>}
                        {t.group_id && <Badge variant="outline" className="text-[10px]">{groups.data?.find((g) => g.id === t.group_id)?.name}</Badge>}
                      </div>
                    </td>
                    <td className="p-3">{cat?.name ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="p-3 text-muted-foreground">{t.source ?? "—"}</td>
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
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Nenhum lançamento neste filtro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <TransactionDialog open={open} onOpenChange={setOpen} initial={editing} />
    </div>
  );
}
