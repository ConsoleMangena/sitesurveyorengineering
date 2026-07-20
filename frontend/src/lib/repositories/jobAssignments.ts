import { getCurrentUser } from "../auth/session.ts";
import { supabase } from "../supabase/client.ts";
import type { Tables, TablesInsert, TablesUpdate } from "../supabase/types.ts";
import { notifyJobAssigned } from "./notificationEvents.ts";

export type JobAssignmentRow = Tables<"job_assignments">;
export type JobAssignmentInsert = TablesInsert<"job_assignments">;
export type JobAssignmentUpdate = TablesUpdate<"job_assignments">;
export type AssignmentMemberRow = Tables<"job_assignment_members">;
export type AssignmentMemberInsert = TablesInsert<"job_assignment_members">;
export type AssignmentAssetRow = Tables<"job_assignment_assets">;
export type AssignmentAssetInsert = TablesInsert<"job_assignment_assets">;

export interface AssignmentWithDetails extends JobAssignmentRow {
  project_name: string | null;
  job_title: string | null;
  member_ids: string[];
  asset_ids: string[];
}

export async function listJobAssignments(
  workspaceId: string,
): Promise<AssignmentWithDetails[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("job_assignments")
    .select("*, projects(name), jobs(title)")
    .eq("workspace_id", workspaceId)
    .order("assignment_date", { ascending: true });

  if (error) throw error;
  if (!data || data.length === 0) return [];

  const assignmentIds = data.map((a) => a.id);

  const [membersResult, assetsResult] = await Promise.all([
    supabase
      .from("job_assignment_members")
      .select("assignment_id, workspace_member_id")
      .in("assignment_id", assignmentIds),
    supabase
      .from("job_assignment_assets")
      .select("assignment_id, asset_id")
      .in("assignment_id", assignmentIds),
  ]);

  if (membersResult.error) throw membersResult.error;
  if (assetsResult.error) throw assetsResult.error;

  const membersByAssignment = new Map<string, string[]>();
  for (const m of membersResult.data ?? []) {
    const list = membersByAssignment.get(m.assignment_id) ?? [];
    list.push(m.workspace_member_id);
    membersByAssignment.set(m.assignment_id, list);
  }

  const assetsByAssignment = new Map<string, string[]>();
  for (const a of assetsResult.data ?? []) {
    const list = assetsByAssignment.get(a.assignment_id) ?? [];
    list.push(a.asset_id);
    assetsByAssignment.set(a.assignment_id, list);
  }

  return data.map((row) => {
    const proj = row.projects as { name: string } | null;
    const job = row.jobs as { title: string } | null;
    return {
      ...row,
      projects: row.projects,
      jobs: row.jobs,
      project_name: proj?.name ?? null,
      job_title: job?.title ?? null,
      member_ids: membersByAssignment.get(row.id) ?? [],
      asset_ids: assetsByAssignment.get(row.id) ?? [],
    } as AssignmentWithDetails;
  });
}

export async function createJobAssignment(
  workspaceId: string,
  input: Omit<JobAssignmentInsert, "workspace_id" | "created_by">,
  memberIds: string[],
  assetIds: string[],
): Promise<JobAssignmentRow> {
  const user = await getCurrentUser();
  if (!user)
    throw new Error("You must be signed in to create an assignment.");

  const { data, error } = await supabase
    .from("job_assignments")
    .insert({ ...input, workspace_id: workspaceId, created_by: user.id })
    .select("*")
    .single();

  if (error) throw error;

  if (memberIds.length > 0) {
    const { error: memberError } = await supabase
      .from("job_assignment_members")
      .insert(
        memberIds.map((workspace_member_id) => ({
          assignment_id: data.id,
          workspace_member_id,
          workspace_id: workspaceId,
        })),
      );
    if (memberError) throw memberError;
  }

  if (assetIds.length > 0) {
    const { error: assetError } = await supabase
      .from("job_assignment_assets")
      .insert(
        assetIds.map((asset_id) => ({
          assignment_id: data.id,
          asset_id,
          workspace_id: workspaceId,
        })),
      );
    if (assetError) throw assetError;
  }

  if (memberIds.length > 0) {
    let jobTitle: string | null = null;
    let projectName: string | null = null;
    if (data.job_id || data.project_id) {
      const [jobRes, projectRes] = await Promise.all([
        data.job_id
          ? supabase.from("jobs").select("title").eq("id", data.job_id).maybeSingle()
          : Promise.resolve({ data: null }),
        data.project_id
          ? supabase
              .from("projects")
              .select("name")
              .eq("id", data.project_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      jobTitle = (jobRes.data as { title?: string } | null)?.title ?? null;
      projectName =
        (projectRes.data as { name?: string } | null)?.name ?? null;
    }

    void notifyJobAssigned({
      workspaceId,
      memberIds,
      jobTitle,
      projectName,
      assignmentId: data.id,
    });
  }

  return data;
}

export async function updateJobAssignment(
  id: string,
  patch: JobAssignmentUpdate,
): Promise<JobAssignmentRow> {
  const user = await getCurrentUser();
  if (!user)
    throw new Error("You must be signed in to update an assignment.");

  const { data, error } = await supabase
    .from("job_assignments")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function replaceAssignmentMembers(
  workspaceId: string,
  assignmentId: string,
  memberIds: string[],
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in.");

  // Capture existing members so we only notify newly added ones.
  const { data: existingMembers } = await supabase
    .from("job_assignment_members")
    .select("workspace_member_id")
    .eq("assignment_id", assignmentId);
  const previousIds = new Set(
    (existingMembers ?? []).map((m) => m.workspace_member_id),
  );

  const { error: deleteError } = await supabase
    .from("job_assignment_members")
    .delete()
    .eq("assignment_id", assignmentId);
  if (deleteError) throw deleteError;

  if (memberIds.length > 0) {
    const { error: insertError } = await supabase
      .from("job_assignment_members")
      .insert(
        memberIds.map((workspace_member_id) => ({
          assignment_id: assignmentId,
          workspace_member_id,
          workspace_id: workspaceId,
        })),
      );
    if (insertError) throw insertError;
  }

  const addedMemberIds = memberIds.filter((id) => !previousIds.has(id));
  if (addedMemberIds.length > 0) {
    const { data: assignment } = await supabase
      .from("job_assignments")
      .select("id, jobs(title), projects(name)")
      .eq("id", assignmentId)
      .maybeSingle();
    const job = assignment?.jobs as { title?: string } | null;
    const project = assignment?.projects as { name?: string } | null;

    void notifyJobAssigned({
      workspaceId,
      memberIds: addedMemberIds,
      jobTitle: job?.title ?? null,
      projectName: project?.name ?? null,
      assignmentId,
    });
  }
}

export async function replaceAssignmentAssets(
  workspaceId: string,
  assignmentId: string,
  assetIds: string[],
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in.");

  const { error: deleteError } = await supabase
    .from("job_assignment_assets")
    .delete()
    .eq("assignment_id", assignmentId);
  if (deleteError) throw deleteError;

  if (assetIds.length > 0) {
    const { error: insertError } = await supabase
      .from("job_assignment_assets")
      .insert(
        assetIds.map((asset_id) => ({
          assignment_id: assignmentId,
          asset_id,
          workspace_id: workspaceId,
        })),
      );
    if (insertError) throw insertError;
  }
}

export async function deleteJobAssignment(id: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user)
    throw new Error("You must be signed in to delete an assignment.");

  await supabase
    .from("job_assignment_members")
    .delete()
    .eq("assignment_id", id);

  await supabase
    .from("job_assignment_assets")
    .delete()
    .eq("assignment_id", id);

  const { error } = await supabase
    .from("job_assignments")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
