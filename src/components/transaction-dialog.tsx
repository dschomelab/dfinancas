import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCategories, useGroups, type Transaction } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { competenceFromDate } from "@/lib/format";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Partial<Transaction> | null;
};

export function TransactionDialog({ open, onOpenChange, initial }: Props) {
  const { user } = useAuth();
  const cats = useCategories();
  const groups = useGroups();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    type: "expense" as "expense" | "income",
    occurred_on: new Date().toISOString().slice(0, 10),
    competence: new Date().toISOString().slice(0, 7),
    description: "",
    grouped_description: "",
    source: "",
    amount: "",
    category_id: "",
    group_id: "",
    is_shared: false,
    notes: "",
  });

  useEffect(() => {
    if (open) {
      const occ = initial?.occurred_on ?? new Date().toISOString().slice(0, 10);
      setForm({
        type: (initial?.type as "expense" | "income") ?? "expense",
        occurred_on: occ,
        competence: initial?.competence ?? competenceFromDate(occ),
        description: initial?.description ?? "",
        grouped_description: initial?.grouped_description ?? "",
        source: initial?.source ?? "",
        amount: initial?.amount?.toString() ?? "",
        category_id: initial?.category_id ?? "",
        group_id: initial?.group_id ?? "",
        is_shared: initial?.is_shared ?? false,
        notes: initial?.notes ?? "",
      });
    }
  }, [open, initial]);

  const filteredCats = (cats.data ?? []).filter((c) => c.type === form.type).slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const submit = async () => {
    if (!user) return;
    const amount = parseFloat(form.amount.replace(",", "."));
    if (!form.description || !form.occurred_on || !form.competence || isNaN(amount)) {
      return toast.error("Preencha descrição, data, competência e valor.");
    }
    setBusy(true);
    const payload = {
      user_id: user.id,
      type: form.type,
      occurred_on: form.occurred_on,
      competence: form.competence,
      description: form.description,
      source: form.source || null,
      amount,
      category_id: form.category_id || null,
      group_id: form.group_id || null,
      is_shared: form.is_shared,
      notes: form.notes || null,
    };
    const { error } = initial?.id
      ? await supabase.from("transactions").update(payload).eq("id", initial.id)
      : await supabase.from("transactions").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(initial?.id ? "Lançamento atualizado" : "Lançamento criado");
    qc.invalidateQueries({ queryKey: ["transactions"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Editar lançamento" : "Novo lançamento"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as "expense" | "income", category_id: "" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Despesa</SelectItem>
                  <SelectItem value="income">Receita</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Data do lançamento</Label>
              <Input type="date" value={form.occurred_on} onChange={(e) => setForm({ ...form, occurred_on: e.target.value, competence: form.competence || competenceFromDate(e.target.value) })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Competência (mês de referência)</Label>
            <Input type="month" value={form.competence} onChange={(e) => setForm({ ...form, competence: e.target.value })} />
            <p className="text-xs text-muted-foreground">Sempre tratada como dia 01 do mês selecionado. Usada nos fechamentos e filtros.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Valor (R$)</Label>
              <Input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Origem</Label>
              <Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Banco, cartão…" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Select value={form.category_id || "none"} onValueChange={(v) => setForm({ ...form, category_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Sem categoria" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem categoria</SelectItem>
                  {filteredCats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Grupo</Label>
              <Select value={form.group_id || "none"} onValueChange={(v) => setForm({ ...form, group_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Pessoal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Pessoal</SelectItem>
                  {(groups.data ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={form.is_shared} onCheckedChange={(v) => setForm({ ...form, is_shared: v })} />
            <Label>Lançamento compartilhado/rateado</Label>
          </div>
          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
