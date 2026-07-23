import { synchronize } from '@nozbe/watermelondb/sync'
import type { Database, TableName } from '@nozbe/watermelondb'
import type { DirtyRaw } from '@nozbe/watermelondb'
import type {
  SyncPullArgs,
  SyncPullResult,
  SyncPushArgs,
  SyncDatabaseChangeSet,
  SyncTableChangeSet,
  Timestamp,
} from '@nozbe/watermelondb/sync'
import { BehaviorSubject } from 'rxjs'
import { supabase } from '../supabase/client.ts'
import type { LocalDb } from './db.ts'

export type OfflineSyncState = 'idle' | 'syncing' | 'synced' | 'error'

export interface OfflineSyncStatus {
  status: OfflineSyncState
  lastError?: string
}

export const offlineSyncStatus$ = new BehaviorSubject<OfflineSyncStatus>({
  status: 'idle',
})

const SYNC_TABLES = [
  'projects',
  'organizations',
  'contacts',
  'assets',
  'asset_calibrations',
  'asset_maintenance_events',
  'time_entries',
  'expense_entries',
  'jobs',
  'job_events',
  'job_assignments',
  'job_assignment_members',
  'job_assignment_assets',
] as const

type SyncTable = (typeof SYNC_TABLES)[number]

const activeIntervals = new Map<string, ReturnType<typeof setInterval>>()
const pendingSyncs = new Map<string, Promise<void>>()

/** Time cap for a single sync pull/push run before we abort the UI wait. */
const SYNC_TIMEOUT_MS = 30000

function recomputeStatus(lastError?: string) {
  // The interval timer is not an active sync; only pending sync runs should
  // keep the UI indicator in the "syncing" state.
  const anyActive = pendingSyncs.size > 0

  if (lastError) {
    offlineSyncStatus$.next({ status: 'error', lastError })
    return
  }

  offlineSyncStatus$.next({ status: anyActive ? 'syncing' : 'synced' })
}

function isAppVisible(): boolean {
  if (typeof document === 'undefined') return true
  return !document.hidden
}

function nowTs(): Timestamp {
  return Math.floor(Date.now() / 1000)
}

function tsToIso(ts: Timestamp): string | null {
  if (!ts) return null
  return new Date(ts * 1000).toISOString()
}

function cleanServerRow(tableName: string, row: Record<string, unknown>): DirtyRaw {
  const raw = { ...row } as Record<string, unknown>
  if (tableName === 'assets' && raw.metadata && typeof raw.metadata === 'object') {
    raw.metadata = JSON.stringify(raw.metadata)
  }
  raw._deleted = row._deleted ?? false
  if (typeof raw.created_at === 'string') {
    raw.created_at = Date.parse(raw.created_at)
  }
  if (typeof raw.updated_at === 'string') {
    raw.updated_at = Date.parse(raw.updated_at)
  }
  return raw as DirtyRaw
}

function preparePayload(tableName: string, raw: Record<string, unknown>, isCreated = false): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  const skip = new Set(['id', '_status', '_changed', '_raw'])

  for (const [key, value] of Object.entries(raw)) {
    if (skip.has(key)) continue
    if (key === 'metadata' && tableName === 'assets' && typeof value === 'string') {
      try {
        payload[key] = JSON.parse(value)
      } catch {
        payload[key] = {}
      }
    } else if (key === 'created_at' || key === 'updated_at') {
      if (typeof value === 'number') {
        payload[key] = new Date(value).toISOString()
      } else if (value !== undefined) {
        payload[key] = value
      }
    } else if (value !== undefined) {
      payload[key] = value
    }
  }

  if (isCreated && (!payload.created_at || typeof payload.created_at !== 'string')) {
    payload.created_at = new Date().toISOString()
  }
  payload.updated_at = new Date().toISOString()

  return payload
}

function typedChangeSet(changes: SyncDatabaseChangeSet): Record<string, SyncTableChangeSet> {
  return changes as unknown as Record<string, SyncTableChangeSet>
}

function supabaseTable(tableName: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from(tableName)
}

async function runSync(wmDatabase: Database, workspaceId: string): Promise<void> {
  offlineSyncStatus$.next({ status: 'syncing' })

  const syncPromise = synchronize({
    database: wmDatabase,
    pullChanges: async (args: SyncPullArgs): Promise<SyncPullResult> => {
      const lastPulledAt = args.lastPulledAt ?? 0
      const since = tsToIso(lastPulledAt)
      const changes: SyncDatabaseChangeSet = {}

      // eslint-disable-next-line no-console
      console.log(`[sync] pulling workspace ${workspaceId} changes since ${since ?? 'beginning'}`)

      await Promise.all(
        SYNC_TABLES.map(async (tableName) => {
          let query = supabaseTable(tableName).select('*').eq('workspace_id', workspaceId)
          if (since) {
            query = query.gt('updated_at', since)
          }
          const { data, error } = await query.order('updated_at', { ascending: true })
          if (error) throw error
          if (!data) return

          const created: DirtyRaw[] = []
          const updated: DirtyRaw[] = []
          const deleted: string[] = []

          for (const untypedRow of data) {
            const row = untypedRow as Record<string, unknown>
            if (row._deleted) {
              deleted.push(String(row.id))
              continue
            }

            const raw = cleanServerRow(tableName, row)
            // On the very first pull (since === null) every non-deleted record is
            // new to this local database and must be reported as `created`.
            const isNew =
              !since ||
              (row.created_at &&
                typeof row.created_at === 'string' &&
                row.created_at > since)
            if (isNew) {
              created.push(raw)
            } else {
              updated.push(raw)
            }
          }

          const changeSetEntry = changes as unknown as Record<string, SyncTableChangeSet>
          changeSetEntry[tableName] = { created, updated, deleted }
        }),
      )

      return { changes, timestamp: nowTs() }
    },

    pushChanges: async ({ changes, lastPulledAt }: SyncPushArgs): Promise<void> => {
      void lastPulledAt
      const typedChanges = typedChangeSet(changes)

      for (const [tableName, ops] of Object.entries(typedChanges)) {
        if (!ops) continue

        for (const created of ops.created) {
          const payload = preparePayload(tableName, created as Record<string, unknown>, true)
          const { error } = await supabaseTable(tableName).insert(payload)
          if (error) throw error
        }

        for (const updated of ops.updated) {
          const row = updated as Record<string, unknown>
          const id = row.id as string | undefined
          if (!id) continue
          const payload = preparePayload(tableName, row, false)
          const { error } = await supabaseTable(tableName).update(payload).eq('id', id)
          if (error) throw error
        }

        if (ops.deleted.length > 0) {
          const now = new Date().toISOString()
          const { error } = await supabaseTable(tableName)
            .update({ _deleted: true, updated_at: now })
            .in('id', ops.deleted)
          if (error) throw error
        }
      }
    },
  })

  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Sync timed out after ${SYNC_TIMEOUT_MS}ms`))
    }, SYNC_TIMEOUT_MS)
  })

  try {
    await Promise.race([syncPromise, timeoutPromise])
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId)
  }

  recomputeStatus()
}

function runWorkspaceSync(wmDatabase: Database, workspaceId: string): Promise<void> {
  const key = workspaceId
  return (async () => {
    let lastError: string | undefined
    try {
      await runSync(wmDatabase, workspaceId)
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line no-console
      console.error(`[sync] workspace ${workspaceId} sync failed:`, err)
    } finally {
      pendingSyncs.delete(key)
      recomputeStatus(lastError)
    }
  })()
}

/**
 * Starts continuous, per-workspace replication for the tables that are
 * enabled for offline-first use. Safe to call multiple times.
 */
export function startWorkspaceSync(db: LocalDb, workspaceId: string) {
  const key = workspaceId
  if (activeIntervals.has(key)) return

  const wmDatabase = db._wmDatabase

  pendingSyncs.set(key, runWorkspaceSync(wmDatabase, workspaceId))

  const interval = setInterval(() => {
    // Don't keep chewing network/IndexedDB while the window is hidden.
    if (!isAppVisible()) return
    if (pendingSyncs.has(key)) return
    pendingSyncs.set(key, runWorkspaceSync(wmDatabase, workspaceId))
  }, 10000)

  activeIntervals.set(key, interval)
  recomputeStatus()
}

/**
 * Stop all active replication states. Useful on sign-out.
 */
export function stopAllSync() {
  for (const interval of activeIntervals.values()) {
    clearInterval(interval)
  }
  activeIntervals.clear()
  pendingSyncs.clear()
  offlineSyncStatus$.next({ status: 'idle' })
}
