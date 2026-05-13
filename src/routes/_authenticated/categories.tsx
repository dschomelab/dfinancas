import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCategories } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/categories")({
  component: CategoriesPage,
});

function CategoriesPage() {
  const cats = useCategories();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [type, setType] = useState<"expense" | "income">("expense");
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [color, setColor] = useState("#3b6fa0");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !name.trim()) return;
    const { error } = await supabase.from("categories").insert({ user_id: user.id, name: name.trim(), type, color, parent: parent.trim() || null });
    if (error) return toast.error(error.message);
    toast.success("Categoria criada");
    setName("");
    qc.invalidateQueries({ queryKey: ["categories"] });
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir categoria?")) return;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["categories"] });
  };

  const grouped = {
    expense: (cats.data ?? []).filter((c) => c.type === "expense"),
    income: (cats.data ?? []).filter((c) => c.type === "income"),
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="font-display text-3xl font-semibold">Categorias</h1>
        <p className="text-sm text-muted-foreground">Crie categorias para organizar despesas e receitas.</p>
      </div>

      <Card className="p-5">
        <form onSubmit={submit} className="grid md:grid-cols-4 gap-3 items-end">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={type} onValueChange={(v) => setType(v as "expense" | "income")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Despesa</SelectItem>
                <SelectItem value="income">Receita</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Alimentação" />
          </div>
          <div className="space-y-1.5">
            <Label>Cor</Label>
            <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10" />
          </div>
          <Button type="submit" className="md:col-span-4">Adicionar categoria</Button>
        </form>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        {(["expense", "income"] as const).map((t) => (
          <Card key={t} className="p-5">
            <h2 className="font-display font-semibold mb-3">{t === "expense" ? "Despesas" : "Receitas"}</h2>
            <div className="space-y-2">
              {grouped[t].length === 0 && <p className="text-sm text-muted-foreground">Nenhuma categoria.</p>}
              {grouped[t].map((c) => (
                <div key={c.id} className="flex items-center justify-between p-2 rounded-md border">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
                    <span>{c.name}</span>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
