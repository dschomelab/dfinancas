import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet, TrendingUp, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="min-h-screen flex items-center justify-center">Carregando…</div>;
  if (user) return <Navigate to="/dashboard" />;

  const handleSignIn = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(fd.get("email")),
      password: String(fd.get("password")),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Bem-vindo de volta!");
    nav({ to: "/dashboard" });
  };

  const handleSignUp = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: String(fd.get("email")),
      password: String(fd.get("password")),
      options: {
        emailRedirectTo: window.location.origin,
        data: { display_name: String(fd.get("name") || "") },
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Conta criada! Já pode entrar.");
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-12 text-sidebar-foreground" style={{ background: "var(--gradient-primary)" }}>
        <div className="flex items-center gap-2">
          <Wallet className="h-6 w-6" />
          <span className="font-display text-xl font-semibold">Finança</span>
        </div>
        <div className="space-y-6">
          <h1 className="font-display text-4xl font-semibold leading-tight">
            Suas despesas e receitas, organizadas com clareza.
          </h1>
          <p className="text-base opacity-90 max-w-md">
            Importe CSV ou PDF, categorize automaticamente e acompanhe por competência. Compartilhe lançamentos com pessoas da sua confiança.
          </p>
          <ul className="space-y-3 text-sm opacity-95">
            <li className="flex items-center gap-3"><Sparkles className="h-4 w-4" /> Importação inteligente com IA</li>
            <li className="flex items-center gap-3"><TrendingUp className="h-4 w-4" /> Visão por competência e categoria</li>
            <li className="flex items-center gap-3"><Users className="h-4 w-4" /> Compartilhamento em grupo</li>
          </ul>
        </div>
        <div className="text-xs opacity-70">© {new Date().getFullYear()} Finança</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6">
          <div className="lg:hidden flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            <span className="font-display font-semibold">Finança</span>
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold">Acesse sua conta</h2>
            <p className="text-sm text-muted-foreground mt-1">Entre ou crie sua conta para começar.</p>
          </div>
          <Tabs defaultValue="signin">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="signin">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="si-email">E-mail</Label>
                  <Input id="si-email" name="email" type="email" required autoComplete="email" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="si-pass">Senha</Label>
                  <Input id="si-pass" name="password" type="password" required autoComplete="current-password" />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="su-name">Nome</Label>
                  <Input id="su-name" name="name" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="su-email">E-mail</Label>
                  <Input id="su-email" name="email" type="email" required autoComplete="email" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="su-pass">Senha</Label>
                  <Input id="su-pass" name="password" type="password" required minLength={6} autoComplete="new-password" />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>{busy ? "Criando…" : "Criar conta"}</Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
