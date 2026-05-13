import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useGroups } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus, Trash2, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/groups")({
  component: GroupsPage,
});

function GroupsPage() {
  const groups = useGroups();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !name.trim()) return;
    const { data, error } = await supabase.from("groups").insert({ name: name.trim(), owner_id: user.id }).select().single();
    if (error) return toast.error(error.message);
    // add self as member
    if (data) await supabase.from("group_members").insert({ group_id: data.id, user_id: user.id, role: "admin" });
    setName("");
    toast.success("Grupo criado");
    qc.invalidateQueries({ queryKey: ["groups"] });
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="font-display text-3xl font-semibold">Grupos</h1>
        <p className="text-sm text-muted-foreground">Crie grupos para compartilhar lançamentos rateados com outras pessoas.</p>
      </div>

      <Card className="p-5">
        <form onSubmit={create} className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do grupo (ex: Casa)" />
          <Button type="submit">Criar</Button>
        </form>
      </Card>

      <div className="space-y-3">
        {(groups.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Você ainda não tem grupos.</p>}
        {(groups.data ?? []).map((g) => <GroupCard key={g.id} groupId={g.id} name={g.name} ownerId={g.owner_id} />)}
      </div>
    </div>
  );
}

function GroupCard({ groupId, name, ownerId }: { groupId: string; name: string; ownerId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const isOwner = user?.id === ownerId;

  const members = useQuery({
    queryKey: ["group-members", groupId],
    queryFn: async () => {
      const { data: gm, error } = await supabase.from("group_members").select("id, user_id, role").eq("group_id", groupId);
      if (error) throw error;
      const ids = (gm ?? []).map((m) => m.user_id);
      const { data: profiles } = ids.length
        ? await supabase.from("profiles").select("id, display_name, email").in("id", ids)
        : { data: [] as { id: string; display_name: string; email: string | null }[] };
      return (gm ?? []).map((m) => ({
        ...m,
        profile: profiles?.find((p) => p.id === m.user_id),
      }));
    },
  });

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    // find user by email in profiles
    const { data, error } = await supabase.from("profiles").select("id").eq("email", email.trim()).maybeSingle();
    if (error || !data) return toast.error("Usuário não encontrado. Peça que ele crie uma conta primeiro.");
    const { error: e2 } = await supabase.from("group_members").insert({ group_id: groupId, user_id: data.id });
    if (e2) return toast.error(e2.message);
    setEmail("");
    toast.success("Membro adicionado");
    qc.invalidateQueries({ queryKey: ["group-members", groupId] });
  };

  const removeMember = async (id: string) => {
    const { error } = await supabase.from("group_members").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["group-members", groupId] });
  };

  const removeGroup = async () => {
    if (!confirm("Excluir este grupo?")) return;
    const { error } = await supabase.from("groups").delete().eq("id", groupId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["groups"] });
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h3 className="font-display font-semibold">{name}</h3>
        </div>
        {isOwner && <Button size="sm" variant="ghost" onClick={removeGroup}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
      </div>

      <div className="mt-3 space-y-2">
        {(members.data ?? []).map((m) => (
          <div key={m.id} className="flex items-center justify-between text-sm p-2 rounded-md bg-muted/40">
            <div>
              <div className="font-medium">{m.profile?.display_name || m.profile?.email || m.user_id.slice(0, 8)}</div>
              <div className="text-xs text-muted-foreground">{m.profile?.email} · {m.role}</div>
            </div>
            {isOwner && m.user_id !== ownerId && (
              <Button size="icon" variant="ghost" onClick={() => removeMember(m.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            )}
          </div>
        ))}
      </div>

      {isOwner && (
        <form onSubmit={invite} className="mt-3 flex gap-2">
          <Input type="email" placeholder="E-mail do membro" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit"><UserPlus className="h-4 w-4 mr-1" /> Adicionar</Button>
        </form>
      )}
    </Card>
  );
}

function GroupsRedirect() {
  return null;
}
void GroupsRedirect;
