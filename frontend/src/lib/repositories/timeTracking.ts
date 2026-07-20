import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "../auth/session.ts";
import { supabase } from "../supabase/client.ts";

// Cast to generic SupabaseClient so we can query tables not in the generated schema
const trackingDb = supabase as unknown as SupabaseClient;

export interface TimeEntryRow {
  id: string;
  workspace_id: string;
  user_id: string;
  project_id: string | null;
  entry_date: string;
  task: string;
  hours: number;
  billable: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  projects?: { name: string | null } | null;
}

export interface ExpenseEntryRow {
  id: string;
  workspace_id: string;
  user_id: string;
  project_id: string | null;
  entry_date: string;
  category: string;
  amount: number;
  vendor: string | null;
  reimbursable: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  projects?: { name: string | null } | null;
}

type TimeEntryInsert = Pick<
  TimeEntryRow,
  "entry_date" | "task" | "hours" | "billable" | "project_id" | "notes"
>;

type ExpenseEntryInsert = Pick<
  ExpenseEntryRow,
  "entry_date" | "category" | "amount" | "vendor" | "reimbursable" | "project_id" | "notes"
>;

export async function listTimeEntries(workspaceId: string): Promise<TimeEntryRow[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const { data, error } = await trackingDb
    .from("time_entries")
    .select("*, projects(name)")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as TimeEntryRow[];
}

export async function listExpenseEntries(workspaceId: string): Promise<ExpenseEntryRow[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const { data, error } = await trackingDb
    .from("expense_entries")
    .select("*, projects(name)")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ExpenseEntryRow[];
}

export async function createTimeEntry(
  workspaceId: string,
  input: TimeEntryInsert,
): Promise<TimeEntryRow> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in to log time.");

  const { data, error } = await trackingDb
    .from("time_entries")
    .insert({
      ...input,
      workspace_id: workspaceId,
      user_id: user.id,
    })
    .select("*, projects(name)")
    .single();

  if (error) throw error;
  return data as TimeEntryRow;
}

export async function createExpenseEntry(
  workspaceId: string,
  input: ExpenseEntryInsert,
): Promise<ExpenseEntryRow> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in to log expenses.");

  const { data, error } = await trackingDb
    .from("expense_entries")
    .insert({
      ...input,
      workspace_id: workspaceId,
      user_id: user.id,
    })
    .select("*, projects(name)")
    .single();

  if (error) throw error;
  return data as ExpenseEntryRow;
}

export async function deleteTimeEntry(id: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in to delete a time entry.");

  const { error } = await trackingDb
    .from("time_entries")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw error;
}

export async function deleteExpenseEntry(id: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in to delete an expense entry.");

  const { error } = await trackingDb
    .from("expense_entries")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw error;
}
