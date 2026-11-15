import { Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './lib/app.jsx';
import Layout from './components/Layout.jsx';
import { Button, Spinner } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Customers from './pages/Customers.jsx';
import CustomerProfile from './pages/CustomerProfile.jsx';
import Packages from './pages/Packages.jsx';
import Invoices from './pages/Invoices.jsx';
import InvoiceView from './pages/InvoiceView.jsx';
import Payments from './pages/Payments.jsx';
import ReceiptView from './pages/ReceiptView.jsx';
import Finance from './pages/Finance.jsx';
import Reports from './pages/Reports.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';
import AuditLog from './pages/AuditLog.jsx';

function AdminOnly({ children }) {
  const { isAdmin } = useApp();
  return isAdmin ? children : <Navigate to="/" replace />;
}

function Shell() {
  const { loading, error, user, refresh, t } = useApp();
  if (loading) return <Spinner />;
  if (error && !user) {
    return (
      <div className="mx-auto mt-24 max-w-md rounded-xl border border-red-200 bg-white p-6 text-center">
        <p className="mb-4 text-sm text-red-700">{error}</p>
        <Button variant="primary" onClick={refresh}>{t('Try again')}</Button>
      </div>
    );
  }
  if (!user) return <Login />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerProfile />} />
        <Route path="/packages" element={<Packages />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/invoices/:id" element={<InvoiceView />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/payments/:id" element={<ReceiptView />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/users" element={<AdminOnly><Users /></AdminOnly>} />
        <Route path="/settings" element={<AdminOnly><Settings /></AdminOnly>} />
        <Route path="/audit" element={<AdminOnly><AuditLog /></AdminOnly>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
