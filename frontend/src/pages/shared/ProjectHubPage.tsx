import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Plus,
  Search,
  X,
  ArrowLeft,
  LayoutGrid,
  Crosshair,
  Calculator,
  MapPin,
  PenTool,
  Settings,
  Menu,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

import '../../styles/project-hub.css'
import '../../styles/pages.css'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ResponsiveTable } from '@/components/ui/responsive-table'
import { DashboardShell, DashboardHeader } from '@/components/dashboard/DashboardShell.tsx'

import {
  listProjects,
  createProject,
  updateProject,
  archiveProject,
  unarchiveProject,
  deleteProject,
  listProjectMembers,
  listProjectActivities,
  createProjectActivity,
  deleteProjectActivity,
  type ProjectActivity,
  type ProjectUpdate,
} from '../../lib/repositories/projects.ts'
import { listAssets, updateAsset, type AssetRow } from '../../lib/repositories/assets.ts'
import PageLoader from '../../components/PageLoader.tsx'
import { listOrganizations, createOrganization } from '../../lib/repositories/organizations.ts'
import type { OrganizationRow } from '../../lib/repositories/organizations.ts'
import { mapProjectRowToHubProject, type UiHubProject } from '../../lib/mappers.ts'
import { inviteWorkspaceMember } from '../../lib/repositories/invitations.ts'
import { getMyWorkspaceMembership, getWorkspaceById } from '../../lib/repositories/workspaces.ts'
import { canManageProjects, canManageTeam } from '../../lib/permissions.ts'
import { ProjectDashboard } from '../../features/projects/components/ProjectDashboard.tsx'
import { ProjectSettings } from '../../features/projects/components/ProjectSettings.tsx'
import { CadWorkspace } from '../../features/projects/components/CadWorkspace.tsx'
import {
  PROJECT_TOOLS,
  PROJECT_TOOLS_BY_ID,
  PINNED_TOOLS,
  NON_CAD_TOOLS,
  COMING_SOON_TOOLS,
  type ProjectTool,
  type ToolCategory,
  type CalcToolId,
} from '../../features/projects/tools/toolRegistry.ts'
import { CalculatorHost } from '../../features/projects/tools/calculators/CalculatorHost.tsx'
import { getProjectMetrics, type ProjectMetrics } from '../../lib/repositories/projectMetrics.ts'
import { hasFeature, CAD_FEATURE_KEY } from '../../lib/repositories/features.ts'

export type HubProject = UiHubProject

interface ProjectHubPageProps {
  userName: string
  workspaceId: string
  onEnterFullscreenProject?: () => void
  onExitFullscreenProject?: () => void
}

const ACTIVE_PROJECT_KEY = 'sitesurveyorActiveProjectId'
const RECENT_TOOLS_KEY = 'sitesurveyorRecentProjectTools'

type ProjectTab = 'overview' | 'surveySetup' | 'geodesy' | 'fieldData' | 'drafting' | 'settings'

const TAB_TO_CATEGORY: Record<string, ToolCategory> = {
  surveySetup: 'Survey Setup',
  geodesy: 'COGO & Computation',
  fieldData: 'Field Data',
  drafting: 'Drafting & Outputs',
}

const statusBadgeVariant: Record<string, BadgeProps['variant']> = {
  Active: 'success',
  Completed: 'default',
  'On Hold': 'warning',
  Draft: 'secondary',
  Archived: 'secondary',
}

const tabIcons: Record<ProjectTab, React.ReactNode> = {
  overview: <LayoutGrid size={17} />,
  surveySetup: <Crosshair size={17} />,
  geodesy: <Calculator size={17} />,
  fieldData: <MapPin size={17} />,
  drafting: <PenTool size={17} />,
  settings: <Settings size={17} />,
}

export default function ProjectHubPage({ userName, workspaceId, onEnterFullscreenProject, onExitFullscreenProject }: ProjectHubPageProps) {
  const [projects, setProjects] = useState<HubProject[]>([])
  const [organizations, setOrganizations] = useState<OrganizationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ type: 'success' | 'info'; message: string } | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const [selectedProject, setSelectedProject] = useState<HubProject | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showPermanentDeleteConfirm, setShowPermanentDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [assignEmail, setAssignEmail] = useState('')
  const [assigningMember, setAssigningMember] = useState(false)
  const [myRole, setMyRole] = useState<'owner' | 'admin' | 'ops_manager' | 'finance' | 'sales' | 'technician' | 'viewer' | null>(null)
  const [workspaceType, setWorkspaceType] = useState<'personal' | 'business' | null>(null)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => localStorage.getItem(ACTIVE_PROJECT_KEY))
  const [activeProjectTab, setActiveProjectTab] = useState<ProjectTab>('overview')
  const [activeWorkspaceView, setActiveWorkspaceView] = useState<'project' | 'cad'>('project')
  const [activeCalcTool, setActiveCalcTool] = useState<CalcToolId | null>(null)
  const [deployedAssets, setDeployedAssets] = useState<AssetRow[]>([])
  const [cadEntitled, setCadEntitled] = useState(false)
  const [metrics, setMetrics] = useState<ProjectMetrics | null>(null)

  const [editName, setEditName] = useState('')
  const [editClient, setEditClient] = useState('')
  const [editOrgId, setEditOrgId] = useState('')
  const [editPhase, setEditPhase] = useState('')
  const [editDatum, setEditDatum] = useState('')
  const [editStatus, setEditStatus] = useState('')
  const [editDesc, setEditDesc] = useState('')

  const [activities, setActivities] = useState<ProjectActivity[]>([])
  const [newActivityText, setNewActivityText] = useState('')
  const [submittingActivity, setSubmittingActivity] = useState(false)
  const [deletingActivityId, setDeletingActivityId] = useState<string | null>(null)
  const [overviewActivitySectionIndex, setOverviewActivitySectionIndex] = useState(0)
  const [settingsActivitySectionIndex, setSettingsActivitySectionIndex] = useState(0)

  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<'All' | 'Active' | 'Completed' | 'Mine' | 'Archived'>('All')

  const [newName, setNewName] = useState('')
  const [newOrgId, setNewOrgId] = useState('')
  const [newOrgName, setNewOrgName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newPhase, setNewPhase] = useState('Planning')
  const [newDatum, setNewDatum] = useState('WGS84 / UTM 36S')
  const [customDatum, setCustomDatum] = useState('')
  const [saving, setSaving] = useState(false)

  const [projectSidebarCollapsed, setProjectSidebarCollapsed] = useState(false)
  const [projectMobileMenuOpen, setProjectMobileMenuOpen] = useState(false)

  const projectTabs = useMemo<ProjectTab[]>(() => {
    return (['overview', 'surveySetup', 'geodesy', 'fieldData', 'drafting', 'settings'] as ProjectTab[]).filter((tab) => {
      if (tab === 'overview' || tab === 'settings') return true
      const cat = TAB_TO_CATEGORY[tab]
      return NON_CAD_TOOLS.some(t => t.category === cat && t.behavior.kind !== 'soon')
    })
  }, [])
  const [toolSearchQuery, setToolSearchQuery] = useState('')
  const [toolFilter, setToolFilter] = useState<'all' | 'free'>('all')
  const [recentToolIds, setRecentToolIds] = useState<string[]>(() => {
    const raw = localStorage.getItem(RECENT_TOOLS_KEY)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter((id): id is string => typeof id === 'string').slice(0, 8)
    } catch {
      return []
    }
  })

  useEffect(() => {
    if (activeProjectId) localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId)
    else localStorage.removeItem(ACTIVE_PROJECT_KEY)
  }, [activeProjectId])

  useEffect(() => {
    let cancelled = false
    if (!activeProjectId) {
      setDeployedAssets([])
      return
    }
    const activeProjectName = projects.find(p => p.dbId === activeProjectId || p.id === activeProjectId)?.name
    listAssets(workspaceId).then((allAssets) => {
      if (cancelled) return
      const projAssets = allAssets.filter(a => {
        const meta = a.metadata as Record<string, unknown>
        return meta?.current_project_name === activeProjectName && a.status === 'deployed'
      })
      setDeployedAssets(projAssets)
    }).catch(() => { if (!cancelled) setDeployedAssets([]) })
    return () => { cancelled = true }
  }, [activeProjectId, projects, workspaceId])

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [rows, orgs] = await Promise.all([
        listProjects(workspaceId),
        listOrganizations(workspaceId),
      ])
      setOrganizations(orgs)

      const mapped = await Promise.all(
        rows.map(async (row) => {
          try {
            const members = await listProjectMembers(row.id)
            return mapProjectRowToHubProject(
              { ...row, organization_name: row.organization_name },
              members.map(m => ({ full_name: m.full_name, email: m.email, role: m.role })),
            )
          } catch {
            return mapProjectRowToHubProject(
              { ...row, organization_name: row.organization_name },
              [],
            )
          }
        }),
      )
      setProjects(mapped)

      const [membership, workspace] = await Promise.all([
        getMyWorkspaceMembership(workspaceId),
        getWorkspaceById(workspaceId),
      ])
      setMyRole((membership?.role ?? null) as typeof myRole)
      setWorkspaceType(workspace?.type ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects.')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { void fetchProjects() }, [fetchProjects])

  useEffect(() => {
    let cancelled = false
    hasFeature(workspaceId, CAD_FEATURE_KEY)
      .then((ok) => { if (!cancelled) setCadEntitled(ok) })
      .catch(() => { if (!cancelled) setCadEntitled(false) })
    return () => { cancelled = true }
  }, [workspaceId])

  useEffect(() => {
    localStorage.setItem(RECENT_TOOLS_KEY, JSON.stringify(recentToolIds))
  }, [recentToolIds])

  const activeProject = activeProjectId ? projects.find(p => p.dbId === activeProjectId || p.id === activeProjectId) ?? null : null

  useEffect(() => {
    if (!activeProjectId) return
    if (!activeProject) setActiveProjectId(null)
  }, [activeProject, activeProjectId])

  useEffect(() => {
    if (!activeProject) setActiveWorkspaceView('project')
  }, [activeProject])

  useEffect(() => {
    if (!projectTabs.includes(activeProjectTab)) {
      setActiveProjectTab('overview')
    }
  }, [projectTabs, activeProjectTab])

  const filteredProjects = projects.filter((p) => {
    if (activeFilter === 'Active' && p.status !== 'Active') return false
    if (activeFilter === 'Completed' && p.status !== 'Completed') return false
    if (activeFilter === 'Archived' && p.status !== 'Archived') return false
    if (activeFilter === 'Mine' && (!p.members.some((m) => m.name === userName) || p.status === 'Archived')) return false
    if (activeFilter === 'All' && p.status === 'Archived') return false

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const searchable = [p.name, p.client, p.id, p.datum, p.phase].join(' ').toLowerCase()
      if (!searchable.includes(q)) return false
    }
    return true
  })

  const counts = {
    All: projects.filter(p => p.status !== 'Archived').length,
    Active: projects.filter(p => p.status === 'Active').length,
    Completed: projects.filter(p => p.status === 'Completed').length,
    Mine: projects.filter(p => p.status !== 'Archived' && p.members.some((m) => m.name === userName)).length,
    Archived: projects.filter(p => p.status === 'Archived').length,
  }

  const canEditProjects = canManageProjects(myRole)
  const canInviteProjectMembers = canManageTeam(myRole, workspaceType)

  const recentTools = useMemo(() => {
    return recentToolIds
      .map(id => PROJECT_TOOLS_BY_ID[id])
      .filter((t): t is (typeof PROJECT_TOOLS)[number] => Boolean(t) && t.behavior.kind === 'calc')
  }, [recentToolIds])

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    setSaving(true)
    setError(null)
    try {
      let organizationId: string | null = newOrgId || null
      if (!organizationId && newOrgName.trim()) {
        const org = await createOrganization(workspaceId, { name: newOrgName.trim(), organization_type: 'client' })
        organizationId = org.id
      }
      await createProject(workspaceId, {
        name: newName.trim(),
        organization_id: organizationId,
        description: newDesc.trim() || null,
        phase: newPhase || 'Planning',
        datum: newDatum === 'custom' ? (customDatum || null) : (newDatum || null),
        status: 'active',
      })
      setShowNewModal(false)
      setNewName('')
      setNewOrgId('')
      setNewOrgName('')
      setNewDesc('')
      setNewPhase('Planning')
      setNewDatum('WGS84 / UTM 36S')
      setCustomDatum('')
      await fetchProjects()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project.')
    } finally {
      setSaving(false)
    }
  }

  const fetchActivities = useCallback(async () => {
    if (!activeProjectId) return
    const logs = await listProjectActivities(activeProjectId)
    setActivities(logs)
  }, [activeProjectId])

  const fetchMetrics = useCallback(async () => {
    if (!activeProjectId) {
      setMetrics(null)
      return
    }
    const m = await getProjectMetrics(activeProjectId)
    setMetrics(m)
  }, [activeProjectId])

  useEffect(() => {
    if (activeProject) {
      setEditName(activeProject.name)
      setEditClient(activeProject.client)
      setEditOrgId(activeProject.organizationId ?? '')
      setEditPhase(activeProject.phase)
      setEditDatum(activeProject.datum)
      setEditStatus(activeProject.status)
      setEditDesc(activeProject.description)
      void fetchActivities()
      void fetchMetrics()
    }
  }, [activeProject, fetchActivities, fetchMetrics])

  const handleUpdateProject = async () => {
    if (!activeProject) return
    setSaving(true)
    try {
      await updateProject(activeProject.dbId, {
        name: editName,
        organization_id: editOrgId || null,
        phase: editPhase,
        datum: editDatum,
        status: editStatus.toLowerCase().replace(/ /g, '_') as ProjectUpdate['status'],
        description: editDesc,
      })
      await fetchProjects()
      setNotice({ type: 'success', message: 'Project configuration updated successfully.' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update project.')
    } finally {
      setSaving(false)
    }
  }

  const handleAddActivity = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newActivityText.trim() || !activeProjectId) return
    setSubmittingActivity(true)
    try {
      await createProjectActivity(activeProjectId, newActivityText, 'note')
      setNewActivityText('')
      await fetchActivities()
    } catch (err) {
      console.error(err)
    } finally {
      setSubmittingActivity(false)
    }
  }

  const handleQuickAction = async (action: string) => {
    if (!activeProjectId) return
    try {
      await createProjectActivity(activeProjectId, `Executed: ${action}`, 'action')
      await fetchActivities()
      setNotice({ type: 'info', message: `${action} initialized. Action logged to timeline.` })
    } catch (err) {
      console.error(err)
    }
  }

  const handleDeleteActivity = async (activityId: string) => {
    const previousActivities = activities
    setDeletingActivityId(activityId)
    setActivities(prev => prev.filter(activity => activity.id !== activityId))
    try {
      await deleteProjectActivity(activityId)
      await fetchActivities()
      setNotice({ type: 'success', message: 'Activity deleted.' })
    } catch (err) {
      setActivities(previousActivities)
      const message = err instanceof Error ? err.message : 'Failed to delete activity.'
      setError(`${message} If this persists, apply latest Supabase migrations.`)
    } finally {
      setDeletingActivityId(null)
    }
  }

  const handleDeleteProject = async (dbId: string) => {
    try {
      await archiveProject(dbId)
      setSelectedProject(null)
      setShowDeleteConfirm(false)
      setDeleteConfirmText('')
      if (activeProjectId === dbId) setActiveProjectId(null)
      await fetchProjects()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive project.')
    }
  }

  const handleUnarchiveProject = async (dbId: string) => {
    try {
      await unarchiveProject(dbId)
      setSelectedProject(null)
      await fetchProjects()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unarchive project.')
    }
  }

  const handlePermanentDeleteProject = async (dbId: string) => {
    try {
      await deleteProject(dbId)
      setSelectedProject(null)
      setShowPermanentDeleteConfirm(false)
      setDeleteConfirmText('')
      if (activeProjectId === dbId) setActiveProjectId(null)
      await fetchProjects()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project permanently.')
    }
  }

  const openProject = (p: HubProject) => {
    setActiveProjectTab('overview')
    setActiveProjectId(p.dbId)
    setActiveWorkspaceView('project')
    onEnterFullscreenProject?.()
    setSelectedProject(null)
    setShowDeleteConfirm(false)
    setDeleteConfirmText('')
  }

  const exitProject = () => {
    setActiveWorkspaceView('project')
    setActiveProjectId(null)
    onExitFullscreenProject?.()
  }

  const openCadWorkspace = async () => {
    if (!activeProjectId) return
    if (window.innerWidth < 768) {
      setNotice({ type: 'info', message: 'Engineering Surveyor CAD requires a larger screen. Please use a tablet or desktop.' })
      return
    }
    const entitled = await hasFeature(workspaceId, CAD_FEATURE_KEY)
    setCadEntitled(entitled)
    if (!entitled) {
      setNotice({ type: 'info', message: 'The CAD Engine is a subscribable feature. Request access in Marketplace → System Features.' })
      return
    }
    setActiveWorkspaceView('cad')
    await handleQuickAction('Tool: Engineering Surveyor CAD')
    setNotice({ type: 'info', message: 'Engineering Surveyor CAD opened in full-screen mode.' })
  }

  const exitCadWorkspace = async () => {
    setActiveWorkspaceView('project')
    if (!activeProjectId) return
    await handleQuickAction('Exit: Engineering Surveyor CAD')
    await fetchMetrics()
    setNotice({ type: 'info', message: 'Returned to project workspace.' })
  }

  const handleToolOpen = async (toolId: string) => {
    const tool = PROJECT_TOOLS_BY_ID[toolId]
    if (!tool || !activeProjectId) return
    if (tool.tier === 'paid' && tool.requiresFeature && !cadEntitled) {
      const ok = await hasFeature(workspaceId, tool.requiresFeature)
      setCadEntitled(ok)
      if (!ok) {
        setNotice({ type: 'info', message: `${tool.label} requires the CAD Engine. Request access in Marketplace → System Features.` })
        return
      }
    }
    setRecentToolIds(prev => [toolId, ...prev.filter(id => id !== toolId)].slice(0, 8))
    switch (tool.behavior.kind) {
      case 'cad':
        await openCadWorkspace()
        return
      case 'calc':
        setActiveCalcTool(tool.behavior.calc)
        return
      case 'soon':
        setNotice({ type: 'info', message: `${tool.label} is coming soon. It is not available yet.` })
        return
    }
  }

  const kpiData = activeProject ? [
    {
      label: 'Survey Points',
      value: `${(metrics?.points ?? 0).toLocaleString()}`,
      sub: 'Points in the CAD drawing',
      accentColor: '#3b82f6',
      icon: <Crosshair size={16} />,
    },
    {
      label: 'Team Members',
      value: `${activeProject.members.length}`,
      sub: 'Personnel currently assigned',
      accentColor: '#8b5cf6',
      icon: <Settings size={16} />,
    },
    {
      label: 'Linework',
      value: `${metrics?.linework ?? 0}`,
      sub: `${metrics?.surfaces ?? 0} TIN surface(s)`,
      accentColor: '#10b981',
      icon: <PenTool size={16} />,
    },
    {
      label: 'QA Flags',
      value: `${metrics?.qaFlags ?? 0}`,
      sub: 'Points coded QA/CHECK to review',
      accentColor: '#f59e0b',
      icon: <LayoutGrid size={16} />,
    },
  ] : []

  const recentActivities = activities.slice(0, 12)
  const recentActivitySections = useMemo(() => {
    const chunkSize = 4
    const sections: ProjectActivity[][] = []
    for (let i = 0; i < recentActivities.length; i += chunkSize) {
      sections.push(recentActivities.slice(i, i + chunkSize))
    }
    return sections
  }, [recentActivities])
  const settingsActivitySections = useMemo(() => {
    const chunkSize = 4
    const sections: ProjectActivity[][] = []
    const scoped = activities.slice(0, 12)
    for (let i = 0; i < scoped.length; i += chunkSize) {
      sections.push(scoped.slice(i, i + chunkSize))
    }
    return sections
  }, [activities])
  const timelineSummary = {
    notes: activities.filter(a => a.activity_type === 'note').length,
    actions: activities.filter(a => a.activity_type === 'action').length,
    system: activities.filter(a => a.activity_type === 'system').length,
  }

  const clampedOverviewSectionIndex = Math.min(
    overviewActivitySectionIndex,
    Math.max(0, recentActivitySections.length - 1),
  )
  const clampedSettingsSectionIndex = Math.min(
    settingsActivitySectionIndex,
    Math.max(0, settingsActivitySections.length - 1),
  )

  const handleUndeployAsset = async (assetId: string) => {
    try {
      await updateAsset(assetId, { status: 'available', metadata: { current_project_name: null } })
      setDeployedAssets(prev => prev.filter(a => a.id !== assetId))
      setNotice({ type: 'success', message: 'Asset checked in successfully.' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to undeploy asset.')
    }
  }

  const fullscreenEnterRef = useRef(onEnterFullscreenProject)
  const fullscreenExitRef = useRef(onExitFullscreenProject)
  useEffect(() => { fullscreenEnterRef.current = onEnterFullscreenProject }, [onEnterFullscreenProject])
  useEffect(() => { fullscreenExitRef.current = onExitFullscreenProject }, [onExitFullscreenProject])
  useEffect(() => {
    if (activeProjectId) fullscreenEnterRef.current?.()
    else fullscreenExitRef.current?.()
  }, [activeProjectId])

  if (loading) {
    return (
      <div className="hub-body p-6">
        <PageLoader />
      </div>
    )
  }

  return (
      <DashboardShell className={`hub-body project-hub-body ${activeProject ? 'project-hub-body-fullscreen p-0 gap-0' : ''}`}>
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {notice && (
        <div className={`flex items-center justify-between rounded-lg px-4 py-3 text-sm ${notice.type === 'success' ? 'border border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-900' : 'border border-blue-200 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-900'}`} role="status" aria-live="polite">
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-lg leading-none" aria-label="Dismiss notice">×</button>
        </div>
      )}

      {activeProject ? (
        <div className={`flex flex-1 overflow-hidden ${projectSidebarCollapsed ? '' : ''} ${activeCalcTool || activeWorkspaceView === 'cad' ? '' : ''}`}>
          {projectMobileMenuOpen && (
            <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setProjectMobileMenuOpen(false)} />
          )}
          <aside className={`shrink-0 border-r bg-muted/30 flex flex-col transition-all ${projectSidebarCollapsed ? 'w-16' : 'w-64'} ${projectMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:static z-50 h-full lg:h-auto`}>
            <div className="p-4 border-b">
              <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={exitProject} title="Back to Projects">
                <ArrowLeft size={16} />
                {!projectSidebarCollapsed && <span>Back to Projects</span>}
              </Button>
              {!projectSidebarCollapsed && (
                <div className="mt-3">
                  <p className="font-semibold truncate">{activeProject.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{activeProject.id}</p>
                </div>
              )}
            </div>
            <nav className="flex-1 overflow-auto p-3 space-y-1">
              {projectTabs.map((tab) => (
                <Button
                  key={tab}
                  variant={activeProjectTab === tab ? 'secondary' : 'ghost'}
                  className="w-full justify-start gap-2"
                  onClick={() => { setActiveProjectTab(tab); setProjectMobileMenuOpen(false); }}
                >
                  {tabIcons[tab]}
                  {!projectSidebarCollapsed && <span className="capitalize">{tab.replace(/([A-Z])/g, ' $1').trim()}</span>}
                </Button>
              ))}
            </nav>
            <div className="p-3 border-t">
              <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={() => setProjectSidebarCollapsed(v => !v)} title={projectSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
                {projectSidebarCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
                {!projectSidebarCollapsed && <span>Collapse</span>}
              </Button>
            </div>
          </aside>

          <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
            {activeWorkspaceView === 'cad' && (
              <CadWorkspace activeProject={activeProject} workspaceId={workspaceId} setProjectMobileMenuOpen={setProjectMobileMenuOpen} exitCadWorkspace={exitCadWorkspace} />
            )}
            {activeCalcTool && (
              <CalculatorHost calc={activeCalcTool} onClose={() => setActiveCalcTool(null)} />
            )}
            {(activeWorkspaceView !== 'cad' && !activeCalcTool) && (
              <div className="flex flex-col gap-4 p-4 sm:p-6">
                <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <Button variant="outline" size="icon" className="lg:hidden shrink-0" onClick={() => setProjectMobileMenuOpen(true)}>
                      <Menu size={18} />
                    </Button>
                    <div className="min-w-0">
                      <h1 className="text-xl font-bold truncate">{activeProject.name}</h1>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{activeProject.id}</code>
                        <span>·</span>
                        <span>{activeProject.client}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={openCadWorkspace}>Open Engineering Surveyor CAD</Button>
                    <Button size="sm" variant="outline" onClick={() => setSelectedProject(activeProject)}>Details</Button>
                  </div>
                </header>

                {activeProjectTab === 'overview' ? (
                  <ProjectDashboard
                    kpiData={kpiData}
                    activities={activities}
                    timelineSummary={timelineSummary}
                    recentActivities={recentActivities}
                    recentActivitySections={recentActivitySections}
                    overviewActivitySectionIndex={clampedOverviewSectionIndex}
                    setOverviewActivitySectionIndex={setOverviewActivitySectionIndex}
                    newActivityText={newActivityText}
                    setNewActivityText={setNewActivityText}
                    submittingActivity={submittingActivity}
                    deletingActivityId={deletingActivityId}
                    deployedAssets={deployedAssets}
                    onUndeployAsset={handleUndeployAsset}
                    handleAddActivity={handleAddActivity}
                    handleQuickAction={handleQuickAction}
                    handleDeleteActivity={handleDeleteActivity}
                    pinnedTools={PINNED_TOOLS}
                    comingSoonTools={COMING_SOON_TOOLS}
                    cadEntitled={cadEntitled}
                    onOpenTool={handleToolOpen}
                  />
                ) : activeProjectTab === 'settings' ? (
                  <ProjectSettings
                    activeProject={activeProject}
                    editName={editName}
                    setEditName={setEditName}
                    editClient={editClient}
                    organizations={organizations}
                    editOrgId={editOrgId}
                    setEditOrgId={setEditOrgId}
                    editPhase={editPhase}
                    setEditPhase={setEditPhase}
                    editDatum={editDatum}
                    setEditDatum={setEditDatum}
                    editStatus={editStatus}
                    setEditStatus={setEditStatus}
                    editDesc={editDesc}
                    setEditDesc={setEditDesc}
                    handleUpdateProject={handleUpdateProject}
                    saving={saving}
                    canEditProjects={canEditProjects}
                    canInviteProjectMembers={canInviteProjectMembers}
                    handleUnarchiveProject={handleUnarchiveProject}
                    setSelectedProject={setSelectedProject}
                    setShowPermanentDeleteConfirm={setShowPermanentDeleteConfirm}
                    setShowDeleteConfirm={setShowDeleteConfirm}
                    setShowAssignModal={setShowAssignModal}
                    activities={activities}
                    settingsActivitySections={settingsActivitySections}
                    settingsActivitySectionIndex={clampedSettingsSectionIndex}
                    setSettingsActivitySectionIndex={setSettingsActivitySectionIndex}
                    newActivityText={newActivityText}
                    setNewActivityText={setNewActivityText}
                    submittingActivity={submittingActivity}
                    deletingActivityId={deletingActivityId}
                    handleAddActivity={handleAddActivity}
                    handleDeleteActivity={handleDeleteActivity}
                  />
                ) : (
                  <ToolCategoryView
                    activeProjectTab={activeProjectTab}
                    toolSearchQuery={toolSearchQuery}
                    setToolSearchQuery={setToolSearchQuery}
                    toolFilter={toolFilter}
                    setToolFilter={setToolFilter}
                    recentTools={recentTools}
                    handleToolOpen={handleToolOpen}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <DashboardHeader
            title="Projects"
            subtitle="Manage tracking, computations, and deployments for active field operations"
            actions={
              <Button onClick={() => setShowNewModal(true)} disabled={!canEditProjects} className="gap-2">
                <Plus size={16} /> New Project
              </Button>
            }
          />

          <Card className="border-border/60 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b">
              <div className="flex flex-wrap items-center gap-2">
                {(Object.keys(counts) as (keyof typeof counts)[]).map((tab) => (
                  <Button
                    key={tab}
                    variant={activeFilter === tab ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setActiveFilter(tab)}
                    className="gap-1.5"
                  >
                    {tab}
                    <Badge variant={activeFilter === tab ? 'secondary' : 'outline'} className="h-5 px-1.5 text-[10px]">{counts[tab]}</Badge>
                  </Button>
                ))}
              </div>
              <div className="relative w-full sm:w-64">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search reference or client..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-7"
                />
                {searchQuery && (
                  <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <ResponsiveTable>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="hidden sm:table-cell">Client</TableHead>
                  <TableHead className="hidden md:table-cell">Phase</TableHead>
                  <TableHead className="hidden lg:table-cell">Surveyor</TableHead>
                  <TableHead className="hidden xl:table-cell">Datum</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Points</TableHead>
                  <TableHead className="hidden md:table-cell w-48">Progress</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProjects.map((p) => {
                  const surveyor = p.members[0]?.name || 'Unassigned'
                  return (
                    <TableRow
                      key={p.dbId}
                      className="cursor-pointer"
                      onClick={() => setSelectedProject(p)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedProject(p); } }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Open project ${p.name}`}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold">{p.name}</span>
                          <code className="w-fit rounded bg-muted px-1.5 py-0.5 text-xs text-primary font-medium mt-1">{p.id}</code>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell font-medium">{p.client}</TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">{p.phase}</TableCell>
                      <TableCell className="hidden lg:table-cell">{surveyor}</TableCell>
                      <TableCell className="hidden xl:table-cell text-muted-foreground text-xs">{p.datum}</TableCell>
                      <TableCell className="text-right hidden sm:table-cell font-mono font-semibold">{p.points.toLocaleString()}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${p.progress}%` }} />
                          </div>
                          <span className="text-xs font-semibold w-8 text-right">{p.progress}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={statusBadgeVariant[p.status] ?? 'secondary'}>{p.status}</Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            </ResponsiveTable>

            {filteredProjects.length === 0 && (
              <div className="p-12 text-center text-muted-foreground">
                {projects.length === 0 ? 'No projects yet. Create your first project to get started.' : 'No projects found.'}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Assign Team Member */}
      <Dialog open={showAssignModal} onOpenChange={(open) => { if (!open) setShowAssignModal(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Team Member</DialogTitle>
            <DialogDescription>Invite a technician to this project.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!assignEmail || !activeProjectId) return
              setAssigningMember(true)
              try {
                const result = await inviteWorkspaceMember({ workspaceId, email: assignEmail, role: 'technician', projectId: activeProjectId, projectRole: 'member' })
                setNotice({
                  type: 'info',
                  message: result.linkedToProject
                    ? `${assignEmail} was added to the project and invited to the workspace.`
                    : `Invitation generated for ${assignEmail}.`,
                })
                setShowAssignModal(false)
                setAssignEmail('')
                await fetchProjects()
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to invite team member.')
              } finally {
                setAssigningMember(false)
              }
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="assign-email">Team Member Email</Label>
              <Input id="assign-email" type="email" placeholder="surveyor@example.com" value={assignEmail} onChange={e => setAssignEmail(e.target.value)} required autoFocus />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAssignModal(false)}>Cancel</Button>
              <Button type="submit" disabled={assigningMember}>{assigningMember ? 'Sending...' : 'Send Invitation'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* New Project */}
      <Dialog open={showNewModal} onOpenChange={(open) => { if (!open) setShowNewModal(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Initialize Project</DialogTitle>
            <DialogDescription>Create a new project environment.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleCreateProject}>
            <div className="space-y-1.5">
              <Label htmlFor="new-name">Project Name *</Label>
              <Input id="new-name" value={newName} onChange={e => setNewName(e.target.value)} required autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Client (Organization)</Label>
              <Select value={newOrgId} onValueChange={(val) => { setNewOrgId(val); if (val) setNewOrgName(''); }}>
                <SelectTrigger><SelectValue placeholder="Select or create new..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Create new...</SelectItem>
                  {organizations.map(org => <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {!newOrgId && (
                <Input placeholder="Or type a new organization name..." value={newOrgName} onChange={e => setNewOrgName(e.target.value)} className="mt-2" />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-desc">Description</Label>
              <textarea id="new-desc" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Project notes, scope, and deliverables..." rows={3} className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[84px] resize-y" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-phase">Phase</Label>
                <Input id="new-phase" value={newPhase} onChange={e => setNewPhase(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Datum</Label>
                <Select value={newDatum} onValueChange={setNewDatum}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WGS84 / UTM 36S">WGS84 / UTM 36S</SelectItem>
                    <SelectItem value="WGS84 / UTM 35S">WGS84 / UTM 35S</SelectItem>
                    <SelectItem value="Arc 1950">Arc 1950</SelectItem>
                    <SelectItem value="custom">Custom EPSG...</SelectItem>
                  </SelectContent>
                </Select>
                {newDatum === 'custom' && (
                  <Input value={customDatum} onChange={e => setCustomDatum(e.target.value)} placeholder="e.g. EPSG:4326" className="mt-2" autoFocus />
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" className="w-full" disabled={saving}>{saving ? 'Creating...' : 'Launch Environment'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Project Details */}
      <Dialog open={selectedProject !== null} onOpenChange={(open) => { if (!open) { setSelectedProject(null); setShowDeleteConfirm(false); setShowPermanentDeleteConfirm(false); setDeleteConfirmText(''); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedProject && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedProject.name}</DialogTitle>
                <DialogDescription><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{selectedProject.id}</code> · {selectedProject.phase}</DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg border p-3 space-y-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Status</span>
                  <Badge variant={statusBadgeVariant[selectedProject.status] ?? 'secondary'}>{selectedProject.status}</Badge>
                </div>
                <div className="rounded-lg border p-3 space-y-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Client</span>
                  <p className="font-medium">{selectedProject.client}</p>
                </div>
                <div className="rounded-lg border p-3 space-y-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Datum</span>
                  <p className="font-medium">{selectedProject.datum}</p>
                </div>
                <div className="rounded-lg border p-3 space-y-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Points</span>
                  <p className="font-medium">{selectedProject.points.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border p-3 space-y-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Created</span>
                  <p className="font-medium">{selectedProject.createdAt}</p>
                </div>
                <div className="rounded-lg border p-3 space-y-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Last Activity</span>
                  <p className="font-medium">{selectedProject.lastActivity}</p>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Progress</span>
                <div className="flex items-center gap-3">
                  <div className="h-2.5 flex-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${selectedProject.progress}%` }} />
                  </div>
                  <span className="text-sm font-bold w-10 text-right">{selectedProject.progress}%</span>
                </div>
              </div>

              {selectedProject.description && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</span>
                  <p className="text-sm text-muted-foreground leading-relaxed">{selectedProject.description}</p>
                </div>
              )}

              {selectedProject.members.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Team ({selectedProject.members.length})</span>
                  <div className="space-y-2">
                    {selectedProject.members.map((m, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                        <div>
                          <p className="font-medium">{m.name}</p>
                          <p className="text-xs text-muted-foreground">{m.role}</p>
                        </div>
                        <Badge variant={m.status === 'active' ? 'success' : 'warning'}>{m.status === 'active' ? 'Active' : 'Pending'}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {showPermanentDeleteConfirm ? (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-3">
                  <p className="text-sm font-semibold text-destructive">Are you sure you want to PERMANENTLY DELETE this project?</p>
                  <p className="text-sm text-destructive">This will destroy all related field data. Type <strong>{selectedProject.name}</strong> to confirm.</p>
                  <Input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder="Type project name to confirm..." autoFocus />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setShowPermanentDeleteConfirm(false); setDeleteConfirmText(''); }}>Cancel</Button>
                    <Button size="sm" variant="destructive" disabled={deleteConfirmText !== selectedProject.name} onClick={() => handlePermanentDeleteProject(selectedProject.dbId)}>Delete Project Permanently</Button>
                  </div>
                </div>
              ) : showDeleteConfirm ? (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-3">
                  <p className="text-sm font-semibold text-destructive">Are you sure you want to archive this project?</p>
                  <p className="text-sm text-destructive">Type <strong>{selectedProject.name}</strong> to confirm.</p>
                  <Input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder="Type project name to confirm..." autoFocus />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }}>Cancel</Button>
                    <Button size="sm" variant="destructive" disabled={deleteConfirmText !== selectedProject.name} onClick={() => handleDeleteProject(selectedProject.dbId)}>Archive Project</Button>
                  </div>
                </div>
              ) : (
                <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
                  {selectedProject.status === 'Archived' ? (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => handleUnarchiveProject(selectedProject.dbId)}>Restore Project</Button>
                      <Button variant="destructive" onClick={() => setShowPermanentDeleteConfirm(true)}>Delete Forever</Button>
                    </div>
                  ) : (
                    <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)}>Archive Project</Button>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => { setSelectedProject(null); setShowDeleteConfirm(false); setShowPermanentDeleteConfirm(false); setDeleteConfirmText(''); }}>Close</Button>
                    <Button onClick={() => openProject(selectedProject)}>Open Project</Button>
                  </div>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </DashboardShell>
  )
}

type ToolFilter = 'all' | 'free'

function ToolCard({ tool, index, onOpen }: { tool: ProjectTool; index: number; onOpen: (id: string) => void }) {
  const comingSoon = tool.behavior.kind === 'soon'
  const disabled = comingSoon
  const cardRef = useRef<HTMLDivElement | null>(null)
  const Icon = tool.icon

  return (
    <div
      ref={cardRef}
      className={`group flex items-center gap-3 rounded-lg border bg-card p-3 cursor-pointer transition-all hover:shadow-sm hover:border-primary/30 ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      onClick={() => { if (!disabled) onOpen(tool.id) }}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(tool.id) }
        else if (e.key === 'ArrowRight') {
          e.preventDefault()
          const siblings = cardRef.current?.parentElement?.querySelectorAll<HTMLElement>('[tabindex="0"]')
          siblings?.[index + 1]?.focus()
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          const siblings = cardRef.current?.parentElement?.querySelectorAll<HTMLElement>('[tabindex="0"]')
          siblings?.[index - 1]?.focus()
        }
      }}
      tabIndex={disabled ? -1 : 0}
      role="button"
      aria-disabled={disabled}
      title={tool.label}
    >
      <div className="inline-flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors h-9 w-9">
        <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold truncate">{tool.label}</h4>
          {comingSoon ? (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Soon</Badge>
          ) : tool.tier === 'free' ? (
            <Badge variant="success" className="text-[10px] px-1.5 py-0">Free</Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">{tool.description}</p>
      </div>
    </div>
  )
}

function ToolCategoryView({
  activeProjectTab,
  toolSearchQuery,
  setToolSearchQuery,
  toolFilter,
  setToolFilter,
  recentTools,
  handleToolOpen,
}: {
  activeProjectTab: ProjectTab
  toolSearchQuery: string
  setToolSearchQuery: (q: string) => void
  toolFilter: ToolFilter
  setToolFilter: (f: ToolFilter) => void
  recentTools: ProjectTool[]
  handleToolOpen: (id: string) => void
}) {
  const activeCat = TAB_TO_CATEGORY[activeProjectTab]
  const query = toolSearchQuery.trim().toLowerCase()
  const CATEGORY_ORDER: Array<ProjectTool['category']> = [
    'Survey Setup',
    'COGO & Computation',
    'Field Data',
    'Drafting & Outputs',
  ]

  const matchesFilter = (t: ProjectTool) => {
    if (toolFilter === 'free') return t.tier === 'free' && t.behavior.kind !== 'soon'
    return true
  }

  const matchesQuery = (t: ProjectTool) => {
    if (!query) return true
    return `${t.label} ${t.description}`.toLowerCase().includes(query)
  }

  const listableTools = NON_CAD_TOOLS.filter(t => t.behavior.kind !== 'soon')

  const visible = query
    ? listableTools.filter(t => matchesFilter(t) && matchesQuery(t))
    : listableTools.filter(t => t.category === activeCat && matchesFilter(t) && matchesQuery(t))

  const grouped = new Map<ProjectTool['category'], ProjectTool[]>()
  for (const cat of CATEGORY_ORDER) {
    const catTools = visible.filter(t => t.category === cat)
    if (catTools.length) grouped.set(cat, catTools)
  }

  const empty = visible.length === 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{query ? 'Search results' : activeCat}</h3>
        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search tools..." value={toolSearchQuery} onChange={(e) => setToolSearchQuery(e.target.value)} aria-label="Search tools" className="h-9 pl-8 pr-7 text-sm" />
          {toolSearchQuery && (
            <button type="button" onClick={() => setToolSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Filter tools">
        {(['all', 'free'] as ToolFilter[]).map(f => (
          <Button key={f} type="button" variant={toolFilter === f ? 'default' : 'outline'} size="sm" onClick={() => setToolFilter(f)}>
            {f === 'all' ? 'All tools' : 'Free calculators'}
          </Button>
        ))}
      </div>

      {recentTools.length > 0 && !query && toolFilter === 'all' && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Recently used</h4>
          <div className="flex flex-wrap gap-2">
            {recentTools.slice(0, 6).map(tool => (
              <Button key={`recent-${tool.id}`} variant="outline" size="sm" onClick={() => handleToolOpen(tool.id)} disabled={tool.behavior.kind === 'soon'} className="gap-2 h-8 text-xs">
                <tool.icon size={14} strokeWidth={2} aria-hidden="true" />
                {tool.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {!empty ? (
        <div>
          {Array.from(grouped.entries()).map(([cat, tools]) => (
            <section key={cat} className="mb-5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{cat}</h4>
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2" role="list">
                {tools.map((tool, i) => <ToolCard key={tool.id} tool={tool} index={i} onOpen={handleToolOpen} />)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
          <h3 className="text-base font-semibold text-foreground">No standalone tools</h3>
          <p className="text-sm mt-1">This category is handled inside the Engineering Surveyor CAD workspace.</p>
        </div>
      )}
    </div>
  )
}
