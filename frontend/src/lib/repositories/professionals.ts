import { supabase } from '../supabase/client.ts'
import type { Tables, TablesInsert, TablesUpdate } from '../supabase/types.ts'

export type ProfessionalRow = Tables<'professionals'>
export type ProfessionalInsert = TablesInsert<'professionals'>
export type ProfessionalUpdate = TablesUpdate<'professionals'>
type ProfessionalCreateInput = Omit<ProfessionalInsert, 'workspace_id' | 'id' | 'created_at' | 'updated_at'>

export async function listProfessionals(workspaceId: string): Promise<ProfessionalRow[]> {
  const { data, error } = await supabase
    .from('professionals')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to list professionals: ${error.message}`)
  }
  return data ?? []
}

export async function createProfessional(workspaceId: string, payload: ProfessionalCreateInput): Promise<ProfessionalRow> {
  const { data, error } = await supabase
    .from('professionals')
    .insert({ ...payload, workspace_id: workspaceId })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create professional: ${error.message}`)
  }
  return data
}

export async function updateProfessional(
  id: string,
  patch: ProfessionalUpdate,
): Promise<ProfessionalRow> {
  const { data, error } = await supabase
    .from('professionals')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to update professional: ${error.message}`)
  }
  return data as ProfessionalRow
}

export async function deleteProfessional(id: string): Promise<void> {
  const { error } = await supabase.from('professionals').delete().eq('id', id)

  if (error) {
    throw new Error(`Failed to delete professional: ${error.message}`)
  }
}
