/* eslint-disable react-refresh/only-export-components */
// ^ view registries export render helper functions, not components. Lazy page
// components defined here are only consumed inside this file.
import { lazy, Suspense } from "react";
import type { UiUser, WorkspaceView } from "../workspace/types";
import PageLoader from "@/components/PageLoader.tsx";
import PersonalDashboardPage from "../../pages/personal/PersonalDashboardPage";
import SchedulePage from "../../pages/personal/SchedulePage";
import AssetManagementPage from "../../pages/shared/AssetManagementPage";
import ContactsPage from "../../pages/shared/ContactsPage";
import InvoicesPage from "../../pages/shared/InvoicesPage";
import JobsPage from "../../pages/shared/JobsPage";
import MarketplacePage from "../../pages/shared/MarketplacePage";
import NotificationsPage from "../../pages/shared/NotificationsPage";
import ProfileSettingsPage from "../../pages/shared/ProfileSettingsPage";
import QuotesPage from "../../pages/shared/QuotesPage";
import ProfessionalsPage from "../../pages/business/ProfessionalsPage";
import TimeTrackingPage from "../../pages/shared/TimeTrackingPage";

// Lazy-load heavy / infrequently-used pages so they do not bloat the shared
// workspace chunk loaded for every view.
const BillingPage = lazy(() => import("../../pages/shared/BillingPage"));
const FileManagerPage = lazy(() => import("../../pages/shared/FileManagerPage"));
const AdminActivityPage = lazy(() => import("../../pages/admin/AdminActivityPage"));
const AdminAuditPage = lazy(() => import("../../pages/admin/AdminAuditPage"));
const AdminOverviewPage = lazy(() => import("../../pages/admin/AdminOverviewPage"));
const AdminUsersPage = lazy(() => import("../../pages/admin/AdminUsersPage"));
const AdminWorkspacesPage = lazy(() => import("../../pages/admin/AdminWorkspacesPage"));
const AdminFeatureRequestsPage = lazy(() => import("../../pages/admin/AdminFeatureRequestsPage"));
const AdminLicensesPage = lazy(() => import("../../pages/admin/AdminLicensesPage"));
const ProjectHubPage = lazy(() => import("../../pages/shared/ProjectHubPage"));

interface PersonalViewRendererOptions {
  user: UiUser;
  onEnterFullscreenProject: () => void;
  onExitFullscreenProject: () => void;
  onNavigate?: (view: string) => void;
}

export function renderPersonalView(
  activeView: WorkspaceView,
  options: PersonalViewRendererOptions,
) {
  const { user, onEnterFullscreenProject, onExitFullscreenProject, onNavigate } = options;

  switch (activeView) {
    case "dashboard":
      return <PersonalDashboardPage userName={user.name} workspaceId={user.workspaceId} onNavigate={onNavigate} />;

    case "schedule":
      return <SchedulePage workspaceId={user.workspaceId} workspaceType={user.accountType} />;

    case "projects":
      return (
        <Suspense fallback={<PageLoader />}>
          <ProjectHubPage
            userName={user.name}
            workspaceId={user.workspaceId}
            onEnterFullscreenProject={onEnterFullscreenProject}
            onExitFullscreenProject={onExitFullscreenProject}
          />
        </Suspense>
      );

    case "timeTracking":
      return <TimeTrackingPage workspaceId={user.workspaceId} />;

    case "files":
      return (
        <Suspense fallback={<PageLoader />}>
          <FileManagerPage workspaceId={user.workspaceId} />
        </Suspense>
      );

    case "notifications":
      return <NotificationsPage workspaceId={user.workspaceId} onNavigate={onNavigate} />;

    case "quotes":
      return <QuotesPage workspaceId={user.workspaceId} />;

    case "invoices":
      return <InvoicesPage workspaceId={user.workspaceId} />;

    case "billing":
      return (
        <Suspense fallback={<PageLoader />}>
          <BillingPage
            workspaceId={user.workspaceId}
            isPlatformAdmin={user.isPlatformAdmin}
          />
        </Suspense>
      );

    case "contacts":
      return <ContactsPage workspaceId={user.workspaceId} />;

    case "jobs":
      return (
        <JobsPage
          workspaceId={user.workspaceId}
          isPlatformAdmin={user.isPlatformAdmin}
        />
      );

    case "marketplace":
      return (
        <MarketplacePage
          workspaceId={user.workspaceId}
          isPlatformAdmin={user.isPlatformAdmin}
          onNavigate={onNavigate}
        />
      );

    case "assets":
      return <AssetManagementPage workspaceId={user.workspaceId} />;

    case "professionals":
      return (
        <ProfessionalsPage
          workspaceId={user.workspaceId}
          isPlatformAdmin={user.isPlatformAdmin}
        />
      );

    case "admin_overview":
      return (
        <Suspense fallback={<PageLoader />}>
          <AdminOverviewPage isPlatformAdmin={user.isPlatformAdmin} />
        </Suspense>
      );

    case "admin_activity":
      return (
        <Suspense fallback={<PageLoader />}>
          <AdminActivityPage isPlatformAdmin={user.isPlatformAdmin} />
        </Suspense>
      );

    case "admin_users":
      return (
        <Suspense fallback={<PageLoader />}>
          <AdminUsersPage isPlatformAdmin={user.isPlatformAdmin} />
        </Suspense>
      );

    case "admin_workspaces":
      return (
        <Suspense fallback={<PageLoader />}>
          <AdminWorkspacesPage isPlatformAdmin={user.isPlatformAdmin} />
        </Suspense>
      );

    case "admin_feature_requests":
      return (
        <Suspense fallback={<PageLoader />}>
          <AdminFeatureRequestsPage isPlatformAdmin={user.isPlatformAdmin} />
        </Suspense>
      );

    case "admin_audit":
      return (
        <Suspense fallback={<PageLoader />}>
          <AdminAuditPage isPlatformAdmin={user.isPlatformAdmin} />
        </Suspense>
      );

    case "admin_licenses":
      return (
        <Suspense fallback={<PageLoader />}>
          <AdminLicensesPage isPlatformAdmin={user.isPlatformAdmin} />
        </Suspense>
      );

    case "profile":
    default:
      return <ProfileSettingsPage />;
  }
}
