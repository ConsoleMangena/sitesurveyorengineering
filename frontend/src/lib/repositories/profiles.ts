import { getCurrentUser } from "../auth/session.ts";
import { supabase } from "../supabase/client.ts";
import type { Tables, TablesUpdate } from "../supabase/types.ts";

// Keep compatibility when generated DB types lag behind migrations.
export type ProfileRow = Tables<"profiles"> & {
  is_platform_admin?: boolean;
  auth_signup_account_type?: string | null;
  deletion_requested_at?: string | null;
  deleted_at?: string | null;
};
export type ProfileUpdate = TablesUpdate<"profiles">;

export async function getMyProfile(): Promise<ProfileRow | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function updateMyProfile(
  patch: ProfileUpdate,
): Promise<ProfileRow> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("You must be signed in to update your profile.");
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", user.id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function requestAccountDeletion(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("You must be signed in to delete your account.");
  }

  const { data, error } = await supabase.functions.invoke<{ success?: boolean; error?: string }>(
    "delete-user",
    { body: {} },
  );

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
}
