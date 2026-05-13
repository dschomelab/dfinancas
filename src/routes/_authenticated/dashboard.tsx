import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTransactions } from "@/lib/queries";
import { fmtMoney, fmtCompetence } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, CartesianGrid } from "recharts";
import { useCategories } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function competencesAround() {
  const out: string[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function Dashboard() {
  const months = useMemo(competencesAround, []);
  const [comp, setComp] = useState(months[months.length - 1]);
  const tx = useTransactions({ competence: comp, type: "all" });
  const cats = useCategories();

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

  const monthSeriesQuery = useTransactions({ type: "all" });
  const series = useMemo(() => {
    return months.map((m) => {
      const list = (monthSeriesQuery.data ?? []).filter((t) => t.competence === m);
      return {
        m: fmtCompetence(m).slice(0, 3),
        Receitas: list.filter((t) => t.type === "income").reduce((a, b) => a + Number(b.amount), 0),
        Despesas: list.filter((t) => t.type === "expense").reduce((a, b) => a + Number(b.amount), 0),
      };
    });
  }, [monthSeriesQuery.data, months]);

  const COLORS = ["oklch(0.28 0.09 260)", "oklch(0.62 0.13 250)", "oklch(0.62 0.15 155)", "oklch(0.78 0.14 75)", "oklch(0.58 0.21 25)", "oklch(0.5 0.12 300)"];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Visão geral</h1>
          <p className="text-sm text-muted-foreground">Acompanhe receitas e despesas por competência.</p>
        </div>
        <Select value={comp} onValueChange={setComp}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {months.map((m) => <SelectItem key={m} value={m} className="capitalize">{fmtCompetence(m)}</SelectItem>)}
          </SelectContent>
        </Select>
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
                <Bar dataKey="Receitas" fill="oklch(0.62 0.15 155)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Despesas" fill="oklch(0.58 0.21 25)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="font-display font-semibold mb-4">Despesas por categoria</h2>
          {byCategory.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem despesas neste mês.</p>
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
