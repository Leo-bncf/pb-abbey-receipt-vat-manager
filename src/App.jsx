import './App.css'
import { Toaster } from "@/components/ui/toaster"
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { persistOptions } from '@/lib/offlineMail'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import DesktopBridge from '@/components/DesktopBridge';
import Download from '@/pages/Download';
import { AskTextHost } from '@/components/AskText';
import LoginForm, { SetPasswordForm } from '@/components/LoginForm';
import Hub from '@/pages/Hub';
import TenantHome from '@/pages/tenant/TenantHome';
import Tenants from '@/pages/tenant/Tenants';
import Units from '@/pages/tenant/Units';
import Rent from '@/pages/tenant/Rent';
import Compliance from '@/pages/tenant/Compliance';
import Actions from '@/pages/tenant/Actions';
import Prepare from '@/pages/tenant/Prepare';
import Listings from '@/pages/tenant/Listings';
import Report from '@/pages/tenant/Report';
import ServiceCharge from '@/pages/tenant/ServiceCharge';
import Bank from '@/pages/tenant/Bank';
import ToLet from '@/pages/ToLet';
import Mail from '@/pages/Mail';
import MailCalendar from '@/pages/MailCalendar';
import MailPeople from '@/pages/MailPeople';
import Company from '@/pages/Company';
import CarnasReports from '@/pages/CarnasReports';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated, needsPassword } = useAuth();
  const { pathname } = useLocation();

  // The desktop-app download page is open to anyone (no sign-in).
  if (pathname === '/download') return <Download />;
  // Empty units to let, with an enquiry form: open to anyone.
  if (pathname === '/to-let') return <ToLet />;

  // Show loading spinner while checking the session
  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-neutral-200 border-t-neutral-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Not signed in → show the login form
  if (!isAuthenticated) {
    return <LoginForm />;
  }

  // Arrived from an invitation / reset email: choose a password first.
  if (needsPassword) {
    return <SetPasswordForm />;
  }

  // Render the main app
  return (
    <>
    <DesktopBridge />
    <Routes>
      {/* Hub landing */}
      <Route path="/" element={<Hub />} />
      {/* Tenant — property management */}
      <Route path="/tenant" element={<TenantHome />} />
      <Route path="/tenant/actions" element={<Actions />} />
      <Route path="/tenant/prepare/:id" element={<Prepare />} />
      <Route path="/tenant/tenants" element={<Tenants />} />
      <Route path="/tenant/units" element={<Units />} />
      <Route path="/tenant/to-let" element={<Listings />} />
      <Route path="/tenant/report" element={<Report />} />
      <Route path="/tenant/service-charge" element={<ServiceCharge />} />
      <Route path="/tenant/bank" element={<Bank />} />
      <Route path="/tenant/rent" element={<Rent />} />
      <Route path="/tenant/compliance" element={<Compliance />} />
      <Route path="/hallmark" element={<TenantHome />} />
      {/* Mail, Calendar, People — the IONOS Exchange mailboxes, Outlook-style */}
      <Route path="/mail" element={<Mail />} />
      <Route path="/mail/calendar" element={<MailCalendar />} />
      <Route path="/mail/people" element={<MailPeople />} />
      <Route path="/billing" element={<Navigate to="/" replace />} />
      <Route path="/company" element={<Company />} />
      {/* Scanner (Receipts & VAT) pages — each self-contains AppShell */}
      {Object.entries(Pages).map(([path, Page]) => (
        <Route key={path} path={`/${path}`} element={<Page />} />
      ))}
      {/* Carnas (house in France): the same scanner pages on Carnas' own data — see src/lib/workspace.js */}
      <Route path="/carnas" element={<Navigate to="/carnas/Dashboard" replace />} />
      {['Dashboard', 'Upload', 'Review'].map((path) => {
        const Page = Pages[path];
        return <Route key={`carnas-${path}`} path={`/carnas/${path}`} element={<Page key="carnas" />} />;
      })}
      <Route path="/carnas/Reports" element={<CarnasReports />} />
      <Route path="/Admin" element={<Navigate to="/Review" replace />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </>
  );
};


function App() {

  return (
    <AuthProvider>
      <PersistQueryClientProvider client={queryClientInstance} persistOptions={persistOptions}>
        <Router>
          <NavigationTracker />
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <AskTextHost />
        <VisualEditAgent />
      </PersistQueryClientProvider>
    </AuthProvider>
  )
}

export default App
