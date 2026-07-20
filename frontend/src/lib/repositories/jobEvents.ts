import { getCurrentUser } from "../auth/session.ts";
import { supabase } from "../supabase/client.ts";
import type { Tables, TablesInsert, TablesUpdate } from "../supabase/types.ts";

export type JobEventRow = Tables<"job_events">;
export type JobEventInsert = TablesInsert<"job_events">;
export type JobEventUpdate = TablesUpdate<"job_events">;

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) {
    const msg = err.message.toLowerCase();
    return msg.includes("failed to fetch") || msg.includes("network") || msg.includes("ERR_INTERNET_DISCONNECTED");
  }
  if (err instanceof DOMException) {
    return err.name === "NetworkError";
  }
  return false;
}

function throwWithMessage(err: unknown, fallback: string): never {
  if (isNetworkError(err)) {
    throw new Error("You appear to be offline. Please check your internet connection and try again.");
  }
  if (err instanceof Error) throw err;
  throw new Error(fallback);
}

export async function listJobEvents(
  workspaceId: string,
): Promise<JobEventRow[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  try {
    const { data, error } = await supabase
      .from("job_events")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("event_date", { ascending: true });

    if (error) throw error;
    return data ?? [];
  } catch (err) {
    throwWithMessage(err, "Failed to load events");
  }
}

export async function getJobEvent(
  id: string,
): Promise<JobEventRow | null> {
  try {
    const { data, error } = await supabase
      .from("job_events")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (err) {
    throwWithMessage(err, "Failed to load event");
  }
}

export async function createJobEvent(
  workspaceId: string,
  input: Omit<JobEventInsert, "workspace_id" | "created_by">,
): Promise<JobEventRow> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in to create an event.");

  try {
    const { data, error } = await supabase
      .from("job_events")
      .insert({ ...input, workspace_id: workspaceId, created_by: user.id })
      .select("*")
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    throwWithMessage(err, "Failed to save event");
  }
}

export async function updateJobEvent(
  id: string,
  patch: JobEventUpdate,
): Promise<JobEventRow> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in to update an event.");

  try {
    const { data, error } = await supabase
      .from("job_events")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    throwWithMessage(err, "Failed to update event");
  }
}

export async function deleteJobEvent(id: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in to delete an event.");

  try {
    const { error } = await supabase
      .from("job_events")
      .delete()
      .eq("id", id);

    if (error) throw error;
  } catch (err) {
    throwWithMessage(err, "Failed to delete event");
  }
}
