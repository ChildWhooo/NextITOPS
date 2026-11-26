import { Component, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ShieldAlert, ArrowLeft, Compass } from 'lucide-react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { BrandingProvider, useBranding } from '@/context/BrandingContext';
import { AppLayout, BrandMark } from '@/components/AppLayout';
import { Button } from '@/components/ui';
import LoginPage from '@/pages/Login';
import PrivacyPage from '@/pages/Privacy';
import DashboardPage from '@/pages/Dashboard';
import CMDBPage from '@/pages/cmdb/CMDB';
import CIDetailPage from '@/pages/cmdb/CIDetail';
import CIModelPage from '@/pages/cmdb/CIModel';
import RelationModelPage from '@/pages/cmdb/RelationModel';
import RacksPage from '@/pages/cmdb/Racks';
import DatacentersPage from '@/pages/cmdb/Datacenters';
import IPInventoryPage from '@/pages/cmdb/IPInventory';import TopologyPage from '@/pages/cmdb/Topology';import TicketListPage from '@/pages/tickets/TicketList';
import TicketDetailPage from '@/pages/tickets/TicketDetail';
import WorkflowsPage from '@/pages/workflows/Workflows';
import ZabbixPage from '@/pages/integrations/Zabbix';
import AlertsPage from '@/pages/Alerts';
import UsersPage from '@/pages/system/Users';
import RolesPage from '@/pages/system/Roles';
import DeletionPolicyPage from '@/pages/system/DeletionPolicy';
import AppearancePage from '@/pages/system/Appearance';
import MaintenancePage from '@/pages/system/Maintenance';
import MapSettingsPage from '@/pages/system/MapSettings';
import AboutPage from '@/pages/system/About';
import ThemePage from '@/pages/Theme';
import PrivacySettingsPage from '@/pages/system/PrivacySettings';
import ReportsPage from '@/pages/Reports';
import TicketSourcesPage from '@/pages/system/TicketSources';
import BaseDataPage from '@/pages/system/BaseData';
import ThirdPartyPage from '@/pages/system/ThirdParty';
import AuditPage from '@/pages/system/Audit';
import NotificationsPage from '@/pages/system/Notifications';
import ProfilePage from '@/pages/Profile';

function Splash() {
  const { branding } = useBranding();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f7f8fc]">
      <div className="relative">
        <div className="absolute inset-0 animate-ping rounded-2xl bg-brand-500/20" />
        <BrandMark size="lg" />
      </div>
      <p className="mt-5 text-[12px] font-medium text-slate-600">{branding.system_name}</p>
      <p className="mt-1 text-[9.5px] uppercase tracking-[0.2em] text-slate-400">Loading service workspace</p>
    </div>
  );
}

function loginPathForLastUser() {
  const themeUser = localStorage.getItem('nextitops_last_user_id');
  return themeUser ? `/login?themeUser=${themeUser}` : '/login';
}

function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to={loginPathForLastUser()} replace state={{ from: location }} />;
  return <Outlet />;
}

function PermissionGate({ permission, children }: { permission: string | string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-md rounded-lg border border-[#e5e6eb] bg-white p-8 text-center shadow-sm">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-rose-50 text-rose-500"><ShieldAlert className="h-5 w-5" /></span>
          <h1 className="mt-4 text-[17px] font-semibold text-slate-900">没有访问权限</h1>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-500">当前角色无法访问该功能。如需调整权限，请联系系统管理员。</p>
          <Button size="sm" icon={ArrowLeft} className="mt-5" onClick={() => window.history.back()}>返回上一页</Button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function NotFound() {
  const { user } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f8fc] p-6">
      <div className="max-w-md text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg border border-[#e5e6eb] bg-white text-brand-500 shadow-sm"><Compass className="h-6 w-6" /></span>
        <h1 className="mt-5 text-[32px] font-semibold tracking-tight text-slate-900">404</h1>
        <p className="mt-1 text-[13px] text-slate-500">你访问的页面不存在或已被移动。</p>
        <Button size="sm" className="mt-5" onClick={() => { window.location.href = user ? '/' : '/login'; }}>返回工作台</Button>
      </div>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#f7f8fc] p-6">
          <div className="max-w-lg rounded-lg border border-[#e5e6eb] bg-white p-8 shadow-sm">
            <h1 className="text-[16px] font-semibold text-slate-900">页面遇到意外错误</h1>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-500">请刷新页面重试。如果问题持续存在，请联系管理员并提供以下信息。</p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-50 p-3 font-mono text-[10px] text-slate-500">{String(this.state.error?.message || this.state.error)}</pre>
            <Button size="sm" className="mt-4" onClick={() => window.location.reload()}>刷新页面</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <BrandingProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="cmdb" element={<PermissionGate permission="cmdb.view"><CMDBPage /></PermissionGate>} />
                <Route path="cmdb/model" element={<PermissionGate permission="cmdb.model_manage"><CIModelPage /></PermissionGate>} />
                <Route path="cmdb/relations" element={<PermissionGate permission="cmdb.model_manage"><RelationModelPage /></PermissionGate>} />
                <Route path="cmdb/racks" element={<PermissionGate permission="cmdb.view"><RacksPage /></PermissionGate>} />
                <Route path="cmdb/datacenters" element={<PermissionGate permission="cmdb.view"><DatacentersPage /></PermissionGate>} />
                <Route path="cmdb/ips" element={<PermissionGate permission="cmdb.view"><IPInventoryPage /></PermissionGate>} />
                <Route path="cmdb/topology" element={<PermissionGate permission="cmdb.view"><TopologyPage /></PermissionGate>} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="cmdb/:id" element={<PermissionGate permission="cmdb.view"><CIDetailPage /></PermissionGate>} />
                <Route path="tickets/:type" element={<PermissionGate permission="itsm.view"><TicketListPage /></PermissionGate>} />
                <Route path="tickets/:type/:id" element={<PermissionGate permission="itsm.view"><TicketDetailPage /></PermissionGate>} />
                <Route path="workflows" element={<PermissionGate permission="itsm.workflow_manage"><WorkflowsPage /></PermissionGate>} />
                <Route path="alerts" element={<PermissionGate permission="itsm.view"><AlertsPage /></PermissionGate>} />
                <Route path="integrations/zabbix" element={<PermissionGate permission="integration.manage"><ZabbixPage /></PermissionGate>} />
                <Route path="system/users" element={<PermissionGate permission="system.user_manage"><UsersPage /></PermissionGate>} />
                <Route path="system/roles" element={<PermissionGate permission="system.role_manage"><RolesPage /></PermissionGate>} />
                <Route path="system/deletion-policy" element={<PermissionGate permission="system.role_manage"><DeletionPolicyPage /></PermissionGate>} />
                <Route path="system/appearance" element={<PermissionGate permission="system.role_manage"><AppearancePage /></PermissionGate>} />
                <Route path="system/maintenance" element={<PermissionGate permission="system.role_manage"><MaintenancePage /></PermissionGate>} />
                <Route path="system/map-settings" element={<PermissionGate permission="system.role_manage"><MapSettingsPage /></PermissionGate>} />
                <Route path="system/privacy" element={<PermissionGate permission="system.role_manage"><PrivacySettingsPage /></PermissionGate>} />
                <Route path="system/ticket-sources" element={<PermissionGate permission="system.role_manage"><TicketSourcesPage /></PermissionGate>} />
                <Route path="system/base-data" element={<PermissionGate permission="system.role_manage"><BaseDataPage /></PermissionGate>} />
                <Route path="system/third-party" element={<PermissionGate permission="system.role_manage"><ThirdPartyPage /></PermissionGate>} />
                <Route path="system/audit" element={<AuditPage />} />
                <Route path="system/about" element={<AboutPage />} />
                <Route path="system/notifications" element={<PermissionGate permission="notification.manage"><NotificationsPage /></PermissionGate>} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="theme" element={<ThemePage />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          <Toaster
            position="top-right"
            richColors
            closeButton
            toastOptions={{
              style: { fontSize: '12px', borderRadius: '12px', border: '1px solid #e7eaf1' },
              className: 'font-sans',
            }}
          />
        </AuthProvider>
        </BrandingProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
