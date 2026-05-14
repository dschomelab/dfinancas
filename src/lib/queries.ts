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

export function useTransactions(filters: { competence?: string; type?: "expense" | "income" | "all"; categoryId?: string | "all"; groupId?: string | "all" }) {
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
      if (filters.type && filters.type !== "all") q = q.eq("type", filters.type);
      if (filters.categoryId && filters.categoryId !== "all") q = q.eq("category_id", filters.categoryId);
      if (filters.groupId && filters.groupId !== "all") q = q.eq("group_id", filters.groupId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Transaction[];
    },
  });
}
