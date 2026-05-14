import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, Fragment } from "react";
import { useTransactions, useCategories, useProfiles } from "@/lib/queries";
import { fmtMoney, fmtCompetence } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TrendingDown, TrendingUp, Wallet, ChevronDown, ChevronRight, CalendarRange } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, CartesianGrid, Legend } from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
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

const COLORS = ["oklch(0.28 0.09 260)", "oklch(0.62 0.13 250)", "oklch(0.62 0.15 155)", "oklch(0.78 0.14 75)", "oklch(0.58 0.21 25)", "oklch(0.5 0.12 300)", "oklch(0.55 0.16 200)", "oklch(0.7 0.15 100)"];

function Dashboard() {
  const months = useMemo(competencesAround, []);
  const current = months[months.length - 1];
  const [selected, setSelected] = useState<string[]>([current]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const tx = useTransactions({ competences: selected, type: "all" });
  const cats = useCategories();
  const profiles = useProfiles();
  const monthSeries = useTransactions({ type: "all" });

  const totals = useMemo(() => {
    const list = tx.data ?? [];
    const income = list.filter((t) => t.type === "income").reduce((a, b) => a + Number(b.amount), 0);
    const expense = list.filter((t) => t.type === "expense").reduce((a, b) => a + Number(b.amount), 0);
    return { income, expense, balance: income - expense };
  }, [tx.data]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    (tx.data ?? []).filter((t) => t.type === "expense").forEach((t) => {
      const cat = cats.data?.find((c) => c.id === t.category_id);
      const name = cat?.name ?? "Sem categoria";
      map.set(name, (map.get(name) ?? 0) + Number(t.amount));
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [tx.data, cats.data]);

  const byUser = useMemo(() => {
    const map = new Map<string, number>();
    (tx.data ?? []).filter((t) => t.type === "expense").forEach((t) => {
      const p = profiles.data?.find((pr) => pr.id === t.user_id);
      const name = p?.display_name || p?.email || "Você";
      map.set(name, (map.get(name) ?? 0) + Number(t.amount));
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [tx.data, profiles.data]);

  const series = useMemo(() => {
    return months.slice(-6).map((m) => {
      const list = (monthSeries.data ?? []).filter((t) => t.competence === m);
      return {
        m: fmtCompetence(m).slice(0, 3),
        Receitas: list.filter((t) => t.type === "income").reduce((a, b) => a + Number(b.amount), 0),
        Despesas: list.filter((t) => t.type === "expense").reduce((a, b) => a + Number(b.amount), 0),
      };
    });
  }, [monthSeries.data, months]);

  // Matrix: category -> grouped_description (or "—") -> total
  const matrix = useMemo(() => {
    const root = new Map<string, { total: number; groups: Map<string, number> }>();
    (tx.data ?? []).filter((t) => t.type === "expense").forEach((t) => {
      const cat = cats.data?.find((c) => c.id === t.category_id);
      const catName = cat?.name ?? "Sem categoria";
      const gd = (t.grouped_description ?? "").trim() || "— Sem agrupamento";
      const node = root.get(catName) ?? { total: 0, groups: new Map<string, number>() };
      node.total += Number(t.amount);
      node.groups.set(gd, (node.groups.get(gd) ?? 0) + Number(t.amount));
      root.set(catName, node);
    });
    return Array.from(root.entries())
      .map(([name, v]) => ({
        name,
        total: v.total,
        groups: Array.from(v.groups.entries()).map(([g, val]) => ({ name: g, value: val })).sort((a, b) => b.value - a.value),
      }))
      .sort((a, b) => b.total - a.total);
  }, [tx.data, cats.data]);

  const toggleMonth = (m: string) => {
    setSelected((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));
  };

  const toggleExpanded = (name: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const selectedLabel = selected.length === 0
    ? "Nenhuma competência"
    : selected.length === 1
      ? fmtCompetence(selected[0])
      : `${selected.length} competências`;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Visão geral</h1>
          <p className="text-sm text-muted-foreground">Acompanhe receitas e despesas por competência (seleção múltipla).</p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-64 justify-between capitalize">
              <span className="flex items-center gap-2"><CalendarRange className="h-4 w-4" />{selectedLabel}</span>
              <ChevronDown className="h-4 w-4 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-2 max-h-80 overflow-auto">
            <div className="flex justify-between px-2 py-1 text-xs text-muted-foreground">
              <button className="hover:underline" onClick={() => setSelected(months)}>Selecionar tudo</button>
              <button className="hover:underline" onClick={() => setSelected([])}>Limpar</button>
            </div>
            <div className="space-y-1">
              {months.slice().reverse().map((m) => (
                <label key={m} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer">
                  <Checkbox checked={selected.includes(m)} onCheckedChange={() => toggleMonth(m)} />
                  <span className="capitalize text-sm">{fmtCompetence(m)}</span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Receitas" value={fmtMoney(totals.income)} icon={<TrendingUp className="h-5 w-5" />} tone="success" />
        <StatCard label="Despesas" value={fmtMoney(totals.expense)} icon={<TrendingDown className="h-5 w-5" />} tone="destructive" />
        <StatCard label="Saldo" value={fmtMoney(totals.balance)} icon={<Wallet className="h-5 w-5" />} tone={totals.balance >= 0 ? "primary" : "destructive"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-display font-semibold mb-4">Últimos 6 meses</h2>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.015 245)" />
                <XAxis dataKey="m" stroke="oklch(0.5 0.03 255)" fontSize={12} />
                <YAxis stroke="oklch(0.5 0.03 255)" fontSize={12} tickFormatter={(v) => `R$${v}`} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} />
                <Legend />
                <Bar dataKey="Receitas" fill="oklch(0.62 0.15 155)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Despesas" fill="oklch(0.58 0.21 25)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="font-display font-semibold mb-4">Despesas por categoria</h2>
          {byCategory.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem despesas no período.</p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={45} outerRadius={90} paddingAngle={2}>
                    {byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtMoney(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5">
          <h2 className="font-display font-semibold mb-4">Despesas por usuário</h2>
          {byUser.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem despesas no período.</p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={byUser} dataKey="value" nameKey="name" innerRadius={45} outerRadius={90} paddingAngle={2}>
                    {byUser.map((_, i) => <Cell key={i} fill={COLORS[(i + 3) % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtMoney(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="font-display font-semibold mb-4">Despesas abertas — matriz por categoria</h2>
          {matrix.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem despesas no período.</p>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">Categoria / Descrição agrupada</th>
                    <th className="text-right py-2 px-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((cat) => {
                    const isOpen = expanded.has(cat.name);
                    return (
                      <Fragment key={cat.name}>
                        <tr className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => toggleExpanded(cat.name)}>
                          <td className="py-2 px-2 font-medium">
                            <span className="inline-flex items-center gap-1">
                              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              {cat.name}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-right font-medium text-destructive">{fmtMoney(cat.total)}</td>
                        </tr>
                        {isOpen && cat.groups.map((g) => (
                          <tr key={cat.name + g.name} className="border-b bg-muted/20">
                            <td className="py-1.5 px-2 pl-10 text-muted-foreground">{g.name}</td>
                            <td className="py-1.5 px-2 text-right text-muted-foreground">{fmtMoney(g.value)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: "success" | "destructive" | "primary" }) {
  const bg = tone === "success" ? "bg-success/10 text-success" : tone === "destructive" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary";
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div className={`p-2 rounded-md ${bg}`}>{icon}</div>
      </div>
      <div className="mt-3 font-display text-2xl font-semibold">{value}</div>
    </Card>
  );
}
