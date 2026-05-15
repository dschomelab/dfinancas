import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export type Category = {
  id: string;
  user_id: string;
  name: string;
  type: "expense" | "income";
  color: string;
  icon: string;
  parent: string | null;
};

export type Group = {
  id: string;
  name: string;
  owner_id: string;
};

export type Transaction = {
  id: string;
  user_id: string;
  group_id: string | null;
  type: "expense" | "income";
  occurred_on: string;
  competence: string;
  description: string;
  grouped_description: string | null;
  source: string | null;
  amount: number;
  category_id: string | null;
  is_shared: boolean;
  notes: string | null;
};

export function useCategories() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["categories", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase.from("categories").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });
}

export function useGroups() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["groups", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Group[]> => {
      const { data, error } = await supabase.from("groups").select("*").order("created_at");
      if (error) throw error;
      return (data ?? []) as Group[];
    },
  });
}

export type TxFilters = {
  competence?: string;
  competences?: string[];
  type?: "expense" | "income" | "all";
  categoryId?: string | "all";
  groupId?: string | "all";
  shared?: "all" | "shared" | "personal";
};

export function useTransactions(filters: TxFilters) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["transactions", user?.id, filters],
    enabled: !!user,
    queryFn: async (): Promise<Transaction[]> => {
      let q = supabase
        .from("transactions")
        .select("*")
        .order("competence", { ascending: false })
        .order("occurred_on", { ascending: false });
      if (filters.competence) q = q.eq("competence", filters.competence);
      if (filters.competences && filters.competences.length > 0) q = q.in("competence", filters.competences);
      if (filters.type && filters.type !== "all") q = q.eq("type", filters.type);
      if (filters.categoryId && filters.categoryId !== "all") q = q.eq("category_id", filters.categoryId);
      if (filters.groupId && filters.groupId !== "all") q = q.eq("group_id", filters.groupId);
      if (filters.shared === "shared") q = q.eq("is_shared", true);
      if (filters.shared === "personal") q = q.eq("is_shared", false);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Transaction[];
    },
  });
}

export type HistoryEntry = {
  description: string;
  grouped_description: string | null;
  category_id: string | null;
  is_shared: boolean;
  type: "expense" | "income";
  occurred_on: string;
};

export function useTransactionHistory() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["tx-history", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<HistoryEntry[]> => {
      const { data, error } = await supabase
        .from("transactions")
        .select("description, grouped_description, category_id, is_shared, type, occurred_on")
        .order("occurred_on", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as HistoryEntry[];
    },
  });
}

export type Profile = { id: string; display_name: string; email: string | null };

export function useProfiles() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["profiles", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Profile[]> => {
      const { data, error } = await supabase.from("profiles").select("id, display_name, email");
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });
}
