import BusinessDashboardPage from "../../pages/business/BusinessDashboardPage";
import DispatchPage from "../../pages/business/DispatchPage";
import ProfessionalsPage from "../../pages/business/ProfessionalsPage";
import TeamPage from "../../pages/business/TeamPage";
import SchedulePage from "../../pages/personal/SchedulePage";
import AssetManagementPage from "../../pages/shared/AssetManagementPage";
import BillingPage from "../../pages/shared/BillingPage";
import ContactsPage from "../../pages/shared/ContactsPage";
import FileManagerPage from "../../pages/shared/FileManagerPage";
import InvoicesPage from "../../pages/shared/InvoicesPage";
import JobsPage from "../../pages/shared/JobsPage";
import MarketplacePage from "../../pages/shared/MarketplacePage";
import NotificationsPage from "../../pages/shared/NotificationsPage";
import ProfileSettingsPage from "../../pages/shared/ProfileSettingsPage";
import ProjectHubPage from "../../pages/shared/ProjectHubPage";
import QuotesPage from "../../pages/shared/QuotesPage";
import TimeTrackingPage from "../../pages/shared/TimeTrackingPage";
import type { UiUser, WorkspaceView } from "../workspace/types";
import AdminActivityPage from "../../pages/admin/AdminActivityPage";
import AdminAuditPage from "../../pages/admin/AdminAuditPage";
import AdminOverviewPage from "../../pages/admin/AdminOverviewPage";
import AdminUsersPage from "../../pages/admin/AdminUsersPage";
import AdminWorkspacesPage from "../../pages/admin/AdminWorkspacesPage";
import AdminFeatureRequestsPage from "../../pages/admin/AdminFeatureRequestsPage";
import AdminLicensesPage from "../../pages/admin/AdminLicensesPage";

interface BusinessViewRegistryOptions {
  user: UiUser;
  onEnterFullscreenProject: () => void;
  onExitFullscreenProject: () => void;
  onNavigate?: (view: string) => void;
}

export function renderBusinessView(
  activeView: WorkspaceView,
  options: BusinessViewRegistryOptions,
) {
  const { user, onEnterFullscreenProject, onExitFullscreenProject, onNavigate } = options;

  switch (activeView) {
    case "dashboard":
      return <BusinessDashboardPage userName={user.name} workspaceId={user.workspaceId} />;

    case "files":
      return <FileManagerPage workspaceId={user.workspaceId} />;

    case "notifications":
      return <NotificationsPage workspaceId={user.workspaceId} onNavigate={onNavigate} />;

    case "quotes":
      return <QuotesPage workspaceId={user.workspaceId} />;

    case "projects":
      return (
        <ProjectHubPage
          userName={user.name}
          workspaceId={user.workspaceId}
          onEnterFullscreenProject={onEnterFullscreenProject}
          onExitFullscreenProject={onExitFullscreenProject}
        />
      );

    case "timeTracking":
      return <TimeTrackingPage workspaceId={user.workspaceId} />;

    case "dispatch":
      return <DispatchPage workspaceId={user.workspaceId} />;

    case "assets":
      return <AssetManagementPage workspaceId={user.workspaceId} />;

    case "marketplace":
      return (
        <MarketplacePage
          workspaceId={user.workspaceId}
          isPlatformAdmin={user.isPlatformAdmin}
          onNavigate={onNavigate}
        />
      );

    case "professionals":
      return (
        <ProfessionalsPage
          workspaceId={user.workspaceId}
          isPlatformAdmin={user.isPlatformAdmin}
        />
      );

    case "team":
      return <TeamPage workspaceId={user.workspaceId} />;

    case "jobs":
      return (
        <JobsPage
          workspaceId={user.workspaceId}
          isPlatformAdmin={user.isPlatformAdmin}
        />
      );

    case "schedule":
      return <SchedulePage workspaceId={user.workspaceId} workspaceType={user.accountType} />;

    case "billing":
      return (
        <BillingPage
          workspaceId={user.workspaceId}
          isPlatformAdmin={user.isPlatformAdmin}
        />
      );

    case "contacts":
      return <ContactsPage workspaceId={user.workspaceId} />;

    case "invoices":
      return <InvoicesPage workspaceId={user.workspaceId} />;

    case "admin_overview":
      return <AdminOverviewPage isPlatformAdmin={user.isPlatformAdmin} />;

    case "admin_activity":
      return <AdminActivityPage isPlatformAdmin={user.isPlatformAdmin} />;

    case "admin_users":
      return <AdminUsersPage isPlatformAdmin={user.isPlatformAdmin} />;

    case "admin_workspaces":
      return <AdminWorkspacesPage isPlatformAdmin={user.isPlatformAdmin} />;

    case "admin_feature_requests":
      return <AdminFeatureRequestsPage isPlatformAdmin={user.isPlatformAdmin} />;

    case "admin_audit":
      return <AdminAuditPage isPlatformAdmin={user.isPlatformAdmin} />;

    case "admin_licenses":
      return <AdminLicensesPage isPlatformAdmin={user.isPlatformAdmin} />;

    case "profile":
    default:
      return <ProfileSettingsPage />;
  }
}
