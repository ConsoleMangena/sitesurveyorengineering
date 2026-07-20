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

  const { data: blocking, error: blockingError } = await supabase
    .from("workspaces")
    .select("id, name, workspace_members!inner(user_id, status)")
    .eq("owner_user_id", user.id)
    .neq("workspace_members.user_id", user.id)
    .in("workspace_members.status", ["active", "invited"]);

  if (blockingError) throw blockingError;

  if (blocking && blocking.length > 0) {
    const names = blocking.map((w) => w.name).join(", ");
    throw new Error(
      `You own workspaces with other members: ${names}. Transfer ownership or remove those workspaces before deleting your account.`,
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      deletion_requested_at: new Date().toISOString(),
      deleted_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    } as any)
    .eq("id", user.id);

  if (error) throw error;
}
