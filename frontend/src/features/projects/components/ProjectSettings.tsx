import React from 'react';
import type { HubProject } from '../../../pages/shared/ProjectHubPage.tsx';
import type { ProjectActivity } from '../../../lib/repositories/projects.ts';
import type { OrganizationRow } from '../../../lib/repositories/organizations.ts';
import SelectDropdown from '../../../components/SelectDropdown.tsx';

interface ProjectSettingsProps {
  activeProject: HubProject;
  editName: string;
  setEditName: (v: string) => void;
  editClient: string;
  organizations: OrganizationRow[];
  editOrgId: string;
  setEditOrgId: (v: string) => void;
  editPhase: string;
  setEditPhase: (v: string) => void;
  editDatum: string;
  setEditDatum: (v: string) => void;
  editStatus: string;
  setEditStatus: (v: string) => void;
  editDesc: string;
  setEditDesc: (v: string) => void;
  handleUpdateProject: () => Promise<void>;
  saving: boolean;
  canEditProjects: boolean;
  canInviteProjectMembers: boolean;
  handleUnarchiveProject: (dbId: string) => Promise<void>;
  setSelectedProject: (p: HubProject) => void;
  setShowPermanentDeleteConfirm: (v: boolean) => void;
  setShowDeleteConfirm: (v: boolean) => void;
  setShowAssignModal: (v: boolean) => void;

  activities: ProjectActivity[];
  settingsActivitySections: ProjectActivity[][];
  settingsActivitySectionIndex: number;
  setSettingsActivitySectionIndex: React.Dispatch<React.SetStateAction<number>>;
  newActivityText: string;
  setNewActivityText: (v: string) => void;
  submittingActivity: boolean;
  deletingActivityId: string | null;
  handleAddActivity: (e: React.FormEvent) => Promise<void>;
  handleDeleteActivity: (id: string) => Promise<void>;
}

export function ProjectSettings({
  activeProject,
  editName,
  setEditName,
  editClient,
  organizations,
  editOrgId,
  setEditOrgId,
  editPhase,
  setEditPhase,
  editDatum,
  setEditDatum,
  editStatus,
  setEditStatus,
  editDesc,
  setEditDesc,
  handleUpdateProject,
  saving,
  canEditProjects,
  canInviteProjectMembers,
  handleUnarchiveProject,
  setSelectedProject,
  setShowPermanentDeleteConfirm,
  setShowDeleteConfirm,
  setShowAssignModal,
  activities,
  settingsActivitySections,
  settingsActivitySectionIndex,
  setSettingsActivitySectionIndex,
  newActivityText,
  setNewActivityText,
  submittingActivity,
  deletingActivityId,
  handleAddActivity,
  handleDeleteActivity,
}: ProjectSettingsProps) {
  return (
    <div className="project-settings-container responsive-grid-sidebar">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <div className="card project-workspace-card" style={{ padding: '24px' }}>
          <div className="project-settings-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-h)', margin: 0 }}>Project Information</h2>
            <button className="btn btn-primary btn-sm" onClick={handleUpdateProject} disabled={saving || !canEditProjects}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>

          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label className="form-label" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Project Name</label>
            <input type="text" className="input-field" value={editName} onChange={e => setEditName(e.target.value)} />
          </div>

          <div className="responsive-grid-2" style={{ marginBottom: '16px' }}>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Client / Organization</label>
              <SelectDropdown
                className="input-field"
                value={editOrgId}
                onChange={setEditOrgId}
                disabled={!canEditProjects}
                options={[
                  { value: '', label: editClient || 'Unassigned' },
                  ...organizations.map(org => ({ value: org.id, label: org.name })),
                ]}
              />
            </div>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Phase</label>
              <select className="input-field" value={editPhase} onChange={e => setEditPhase(e.target.value)}>
                <option>Planning</option>
                <option>Field Execution</option>
                <option>Data Processing</option>
                <option>Drafting</option>
                <option>Quality Assurance</option>
                <option>Delivered</option>
              </select>
            </div>
          </div>

          <div className="responsive-grid-2" style={{ marginBottom: '16px' }}>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Datum / CRS</label>
              <input type="text" className="input-field" value={editDatum} onChange={e => setEditDatum(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Status</label>
              <select className="input-field" value={editStatus} onChange={e => setEditStatus(e.target.value)}>
                <option>Draft</option>
                <option>Active</option>
                <option>On Hold</option>
                <option>Completed</option>
                <option>Archived</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Description / Scope of Work</label>
            <textarea className="input-field" style={{ minHeight: '100px' }} value={editDesc} onChange={e => setEditDesc(e.target.value)} />
          </div>
        </div>

        <div className="card project-workspace-card" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-h)', margin: 0, marginBottom: '16px' }}>Danger Zone</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {activeProject.status === 'Archived' ? (
              <>
                <div className="project-settings-danger-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', border: '1px solid var(--color-success-border)', background: 'var(--color-success-bg)', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-success)' }}>Restore Project</span>
                    <span style={{ fontSize: '11px', color: 'var(--color-success)' }}>Make project active and editable again.</span>
                  </div>
                <button className="btn btn-sm" style={{ background: 'var(--color-success)', color: '#fff', border: 'none' }} onClick={() => handleUnarchiveProject(activeProject.dbId)} disabled={!canEditProjects}>Restore</button>
                </div>
                <div className="project-settings-danger-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', border: '1px solid var(--color-error-border)', background: 'var(--color-error-bg)', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-error)' }}>Permanent Delete</span>
                    <span style={{ fontSize: '11px', color: 'var(--color-error)' }}>Destroy all project data. This cannot be undone.</span>
                  </div>
                  <button className="btn btn-sm" style={{ background: 'var(--color-error)', color: '#fff', border: 'none' }} onClick={() => { setSelectedProject(activeProject); setShowPermanentDeleteConfirm(true); }} disabled={!canEditProjects}>Delete</button>
                </div>
              </>
            ) : (
              <div className="project-settings-danger-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', border: '1px solid var(--color-error-border)', background: 'var(--color-error-bg)', borderRadius: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-error)' }}>Archive Project</span>
                  <span style={{ fontSize: '11px', color: 'var(--color-error)' }}>Mark project as inactive and read-only.</span>
                </div>
                <button className="btn btn-sm" style={{ background: 'var(--color-error)', color: '#fff', border: 'none' }} onClick={() => { setSelectedProject(activeProject); setShowDeleteConfirm(true); }} disabled={!canEditProjects}>Archive</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <div className="card project-workspace-card" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-h)', margin: 0, marginBottom: '20px' }}>Team Members</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {activeProject.members.map((member, idx) => (
              <div key={idx} className="project-settings-member-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--surface-muted)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-h)' }}>{member.name}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{member.role}</span>
                </div>
                <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: member.status === 'active' ? '#166534' : '#92400e' }}>{member.status}</span>
              </div>
            ))}
            <button className="btn btn-outline btn-sm" style={{ marginTop: '8px', width: '100%' }} onClick={() => setShowAssignModal(true)} disabled={!canInviteProjectMembers}>Assign New Member</button>
          </div>
        </div>

        <div className="card project-workspace-card" style={{ padding: '24px' }}>
          <h3 className="project-dashboard-card-title" style={{ margin: 0, marginBottom: '16px' }}>Project Activity Log</h3>
          <div className="project-dashboard-timeline" style={{ maxHeight: '400px', overflowY: 'auto' }}>
            <form onSubmit={handleAddActivity} style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
              <input className="input-field" placeholder="Add a log entry..." style={{ height: '36px', fontSize: '13px' }} value={newActivityText} onChange={e => setNewActivityText(e.target.value)} />
              <button type="submit" className="btn btn-primary btn-sm" disabled={submittingActivity || !newActivityText.trim()}>Log</button>
            </form>
            {activities.length > 0 && settingsActivitySections[settingsActivitySectionIndex] ? (
              <>
                <section style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '10px', background: 'var(--surface)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span className="badge badge-blue">Section {settingsActivitySectionIndex + 1}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {settingsActivitySections[settingsActivitySectionIndex].length} items
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)' }}>
                    {settingsActivitySectionIndex + 1} / {settingsActivitySections.length}
                  </span>
                </div>
                <div style={{ display: 'grid', gap: '10px' }}>
                  {settingsActivitySections[settingsActivitySectionIndex].map(log => (
                    <div key={log.id} className="project-dashboard-timeline-item" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                        <span className="project-dashboard-timeline-dot" style={{ background: log.activity_type === 'system' ? '#3b82f6' : '#6366f1' }} />
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontSize: '13px', color: 'var(--text-h)' }}>{log.content}</span>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{log.user_name} &bull; {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => handleDeleteActivity(log.id)}
                        disabled={deletingActivityId === log.id}
                        style={{ padding: '2px 8px', lineHeight: 1.2 }}
                      >
                        {deletingActivityId === log.id ? '...' : 'Delete'}
                      </button>
                    </div>
                  ))}
                </div>
                </section>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setSettingsActivitySectionIndex(prev => Math.max(0, prev - 1))}
                    disabled={settingsActivitySectionIndex <= 0}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setSettingsActivitySectionIndex(prev => Math.min(settingsActivitySections.length - 1, prev + 1))}
                    disabled={settingsActivitySectionIndex >= settingsActivitySections.length - 1}
                  >
                    Next
                  </button>
                </div>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px' }}>No activity logged yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
