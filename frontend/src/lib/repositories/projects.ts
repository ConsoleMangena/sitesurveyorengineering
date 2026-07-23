import { getCurrentSession } from "../auth/session.ts";
import { supabase } from "../supabase/client.ts";
import type { Tables, TablesInsert, TablesUpdate } from "../supabase/types.ts";
import { getLocalDatabase, type LocalDb } from "../localDb/db.ts";
import { startWorkspaceSync } from "../localDb/sync.ts";
import { generateLocalId, nowIso, omitNullish } from "../localDb/utils.ts";
import type { ProjectDocType } from "../localDb/schemas.ts";

export type ProjectRow = Tables<"projects">;
export type ProjectInsert = TablesInsert<"projects">;
export type ProjectUpdate = TablesUpdate<"projects">;
export type ProjectMemberRow = Tables<"project_members">;
export type ProjectActivityRow = Tables<"project_activities">;

export interface ProjectWithOrg extends ProjectRow {
  organization_name: string | null;
}

export interface ProjectMemberWithProfile extends ProjectMemberRow {
  full_name: string | null;
  email: string | null;
}

async function getLocalDb(workspaceId?: string): Promise<LocalDb> {
  const session = await getCurrentSession();
  if (!session?.user) throw new Error("You must be signed in.");

  const db = await getLocalDatabase(session.user.id);
  if (workspaceId) {
    startWorkspaceSync(db, workspaceId);
  }
  return db;
}

function toProjectRow(doc: ProjectDocType): ProjectRow {
  const { _deleted: _ignored, ...row } = doc;
  void _ignored;
  return row as ProjectRow;
}

export async function listProjects(
  workspaceId: string,
): Promise<ProjectWithOrg[]> {
  const session = await getCurrentSession();
  if (!session?.user) return [];

  const db = await getLocalDb(workspaceId);

  const docs = await db.projects
    .find({
      selector: {
        workspace_id: workspaceId,
        _deleted: false,
      },
    })
    .sort({ created_at: "desc" })
    .exec();

  const orgDocs = await db.organizations
    .find({
      selector: {
        workspace_id: workspaceId,
        _deleted: false,
      },
    })
    .exec();

  const orgMap = new Map(
    orgDocs
      .map((d) => d.toMutableJSON())
      .filter((o) => !o.archived_at)
      .map((o) => [o.id, o]),
  );

  return docs.map((d) => {
    const row = d.toMutableJSON();
    const project = toProjectRow(row);
    const org = project.organization_id
      ? orgMap.get(project.organization_id)
      : undefined;

    return {
      ...project,
      organization_name: org?.name ?? null,
    } as ProjectWithOrg;
  });
}

export async function getProject(id: string): Promise<ProjectRow | null> {
  const db = await getLocalDb();
  const doc = await db.projects.findOne(id).exec();
  return doc ? toProjectRow(doc.toMutableJSON()) : null;
}

export async function createProject(
  workspaceId: string,
  input: Omit<ProjectInsert, "workspace_id" | "created_by">,
): Promise<ProjectRow> {
  const session = await getCurrentSession();
  if (!session?.user) throw new Error("You must be signed in to create a project.");

  const db = await getLocalDb(workspaceId);

  const doc = await db.projects.insert({
    id: generateLocalId(),
    workspace_id: workspaceId,
    created_by: session.user.id,
    created_at: nowIso(),
    updated_at: nowIso(),
    _deleted: false,
    name: input.name ?? "",
    status: input.status ?? "draft",
    progress: input.progress ?? 0,
    points: input.points ?? 0,
    ...omitNullish(input as unknown as Record<string, unknown>),
  });

  // Server-side trigger `ensure_project_creator_member` adds the creator as a
  // manager once the local insert is pushed to Supabase. The sync engine will
  // keep the project row in sync; project_members are fetched online for now.

  return toProjectRow(doc.toMutableJSON());
}

export async function updateProject(
  id: string,
  patch: ProjectUpdate,
): Promise<ProjectRow> {
  const session = await getCurrentSession();
  if (!session?.user) throw new Error("You must be signed in to update a project.");

  const db = await getLocalDb();
  const doc = await db.projects.findOne(id).exec();
  if (!doc) throw new Error(`Project not found: ${id}`);

  const { id: _id, ...safePatch } = patch;
  void _id;

  await doc.incrementalPatch({
    ...omitNullish(safePatch as unknown as Record<string, unknown>),
    updated_at: nowIso(),
  });

  return toProjectRow(doc.toMutableJSON());
}

export async function archiveProject(id: string): Promise<void> {
  const session = await getCurrentSession();
  if (!session?.user) throw new Error("You must be signed in to archive a project.");

  const db = await getLocalDb();
  const doc = await db.projects.findOne(id).exec();
  if (!doc) throw new Error(`Project not found: ${id}`);

  await doc.incrementalPatch({
    archived_at: nowIso(),
    updated_at: nowIso(),
  });
}

export async function unarchiveProject(id: string): Promise<void> {
  const session = await getCurrentSession();
  if (!session?.user) throw new Error("You must be signed in to unarchive a project.");

  const db = await getLocalDb();
  const doc = await db.projects.findOne(id).exec();
  if (!doc) throw new Error(`Project not found: ${id}`);

  await doc.update({
    $set: {
      archived_at: null,
      updated_at: nowIso(),
    },
  });
}

export async function deleteProject(id: string): Promise<void> {
  const session = await getCurrentSession();
  if (!session?.user) throw new Error("You must be signed in to delete a project.");

  const db = await getLocalDb();
  const doc = await db.projects.findOne(id).exec();
  if (!doc) throw new Error(`Project not found: ${id}`);

  await doc.incrementalPatch({
    _deleted: true,
    updated_at: nowIso(),
  });
}

export async function listProjectMembers(
  projectId: string,
): Promise<ProjectMemberWithProfile[]> {
  const { data: members, error } = await supabase
    .from("project_members")
    .select("*")
    .eq("project_id", projectId);

  if (error) throw error;
  if (!members || members.length === 0) return [];

  const userIds = members.map((m) => m.user_id);

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", userIds);

  if (profileError) throw profileError;

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.id, p]),
  );

  return members.map((m) => {
    const profile = profileMap.get(m.user_id);
    return {
      ...m,
      full_name: profile?.full_name ?? null,
      email: profile?.email ?? null,
    };
  });
}

export type ProjectActivity = ProjectActivityRow & {
  user_name?: string;
};

export async function listProjectActivities(projectId: string): Promise<ProjectActivity[]> {
  const { data, error } = await supabase
    .from("project_activities")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Failed to fetch project activities:", error.message);
    return [];
  }

  const rows = data ?? [];
  const userIds = Array.from(new Set(rows.map((row) => row.user_id).filter((id): id is string => Boolean(id))));
  const profileNameMap = new Map<string, string | null>();

  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);

    if (profileError) {
      console.warn("Failed to resolve activity user names:", profileError.message);
    } else {
      for (const profile of profiles ?? []) {
        profileNameMap.set(profile.id, profile.full_name ?? null);
      }
    }
  }

  return rows.map(row => ({
    ...row,
    user_name: row.user_id
      ? profileNameMap.get(row.user_id) ?? "Unknown User"
      : "System",
  }));
}

export async function createProjectActivity(
  projectId: string,
  content: string,
  type: 'note' | 'action' | 'system' = 'note'
): Promise<ProjectActivityRow> {
  const session = await getCurrentSession();
  const { data, error } = await supabase
    .from("project_activities")
    .insert({
      project_id: projectId,
      user_id: session?.user?.id ?? null,
      content,
      activity_type: type
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function deleteProjectActivity(activityId: string): Promise<void> {
  const session = await getCurrentSession();
  if (!session?.user) throw new Error("You must be signed in to delete an activity.");

  const { error } = await supabase
    .from("project_activities")
    .delete()
    .eq("id", activityId);

  if (error) throw error;
}

export async function addProjectMember(
  workspaceId: string,
  projectId: string,
  userId: string,
  role: string = "member",
): Promise<ProjectMemberRow> {
  const session = await getCurrentSession();
  if (!session?.user)
    throw new Error("You must be signed in to add a project member.");

  const { data, error } = await supabase
    .from("project_members")
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      user_id: userId,
      role,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function removeProjectMember(id: string): Promise<void> {
  const session = await getCurrentSession();
  if (!session?.user)
    throw new Error("You must be signed in to remove a project member.");

  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
