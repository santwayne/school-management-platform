import React from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './components/Login';
import TeacherPortal from './components/TeacherPortal';
import PrincipalDashboard from './components/PrincipalDashboard';
import FinanceAdmin from './components/FinanceAdmin';
import AIGradingPrototype from './components/AIGradingPrototype';
import SuperAdminLogin from './components/SuperAdminLogin';
import SuperAdminDashboard from './components/SuperAdminDashboard';
import ClassManager from './components/ClassManager';
import SyllabusManager from './components/SyllabusManager';
import AdminAttendance from './components/AdminAttendance';
import ClassNotesComposer from './components/ClassNotesComposer';
import StaffBroadcast from './components/StaffBroadcast';
import AdminPayroll from './components/AdminPayroll';
import AdminTransport from './components/AdminTransport';
import StudentTutor from './components/StudentTutor';
import AdminReports from './components/AdminReports';
import AdminSettings from './components/AdminSettings';
import AdminCommunications from './components/AdminCommunications';
import AdminBilling from './components/AdminBilling';

// Pages ported to the new Waynur design bring their own header/nav chrome —
// stacking the old NavBar on top of them would double up navigation.
const SELF_CHROME_PREFIXES = ['/teacher', '/tutor'];

function homeFor(role) {
  if (role === 'student') return '/tutor';
  if (role === 'super_admin') return '/super-admin';
  if (role === 'accountant') return '/accountant/fee-collection';
  return '/teacher';
}

function NavBar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  if (!user) return null;
  if (SELF_CHROME_PREFIXES.some((p) => location.pathname.startsWith(p))) return null;
  if (user.role === 'student') return null;

  return (
    <nav className="bg-white border-b px-6 py-3 flex items-center justify-between flex-wrap gap-y-2">
      <div className="flex gap-5 text-sm font-medium text-gray-700 flex-wrap">
        {user.role !== 'accountant' && <Link to="/teacher" className="hover:text-indigo-600">Teacher Portal</Link>}
        {user.role === 'principal' && (
          <>
            <Link to="/dashboard" className="hover:text-indigo-600">Dashboard</Link>
            <Link to="/finance" className="hover:text-indigo-600">Finance</Link>
            <Link to="/classes" className="hover:text-indigo-600">Classes</Link>
            <Link to="/syllabus" className="hover:text-indigo-600">Syllabus</Link>
            <Link to="/admin/attendance" className="hover:text-indigo-600">Attendance</Link>
          </>
        )}
        {user.role !== 'accountant' && <Link to="/grading" className="hover:text-indigo-600">AI Grading</Link>}
        {user.role !== 'accountant' && <Link to="/class-notes" className="hover:text-indigo-600">Class Notes</Link>}
        {user.role === 'principal' && <Link to="/staff-broadcast" className="hover:text-indigo-600">Staff Broadcast</Link>}
        {user.role === 'principal' && <Link to="/admin/payroll" className="hover:text-indigo-600">Payroll</Link>}
        {user.role === 'principal' && <Link to="/admin/transport" className="hover:text-indigo-600">Transport</Link>}
        {(user.role === 'principal' || user.role === 'accountant') && <Link to="/admin/reports" className="hover:text-indigo-600">Reports</Link>}
        {user.role === 'principal' && <Link to="/admin/communications" className="hover:text-indigo-600">Communications</Link>}
        {user.role === 'principal' && <Link to="/admin/billing" className="hover:text-indigo-600">Billing</Link>}
        {user.role === 'principal' && <Link to="/admin/settings" className="hover:text-indigo-600">Settings</Link>}
        {user.role === 'accountant' && (
          <>
            <Link to="/accountant/fee-collection" className="hover:text-indigo-600">Fee Collection</Link>
            <Link to="/accountant/payroll" className="hover:text-indigo-600">Petty Cash &amp; Payroll</Link>
          </>
        )}
      </div>
      <div className="flex items-center gap-3 text-sm text-gray-500">
        <span>{user.name} ({user.role})</span>
        <button onClick={logout} className="text-indigo-600 font-medium hover:text-indigo-800">Log out</button>
      </div>
    </nav>
  );
}

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homeFor(user.role)} replace />;
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <NavBar />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/student-login" element={<Navigate to="/login" replace />} />
        <Route path="/teacher" element={<ProtectedRoute teacherOrPrincipalOnly><TeacherPortal /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute principalOnly><PrincipalDashboard /></ProtectedRoute>} />
        <Route path="/finance" element={<ProtectedRoute principalOnly><FinanceAdmin /></ProtectedRoute>} />
        <Route path="/classes" element={<ProtectedRoute principalOnly><ClassManager /></ProtectedRoute>} />
        <Route path="/syllabus" element={<ProtectedRoute principalOnly><SyllabusManager /></ProtectedRoute>} />
        <Route path="/admin/attendance" element={<ProtectedRoute principalOnly><AdminAttendance /></ProtectedRoute>} />
        <Route path="/class-notes" element={<ProtectedRoute teacherOrPrincipalOnly><ClassNotesComposer /></ProtectedRoute>} />
        <Route path="/staff-broadcast" element={<ProtectedRoute principalOnly><StaffBroadcast /></ProtectedRoute>} />
        <Route path="/admin/payroll" element={<ProtectedRoute principalOnly><AdminPayroll /></ProtectedRoute>} />
        <Route path="/admin/transport" element={<ProtectedRoute principalOnly><AdminTransport /></ProtectedRoute>} />
        <Route path="/admin/reports" element={<ProtectedRoute financeOnly><AdminReports /></ProtectedRoute>} />
        <Route path="/admin/settings" element={<ProtectedRoute principalOnly><AdminSettings /></ProtectedRoute>} />
        <Route path="/admin/communications" element={<ProtectedRoute principalOnly><AdminCommunications /></ProtectedRoute>} />
        <Route path="/admin/billing" element={<ProtectedRoute principalOnly><AdminBilling /></ProtectedRoute>} />
        <Route path="/accountant/fee-collection" element={<ProtectedRoute accountantOnly><FinanceAdmin /></ProtectedRoute>} />
        <Route path="/accountant/payroll" element={<ProtectedRoute accountantOnly><AdminPayroll /></ProtectedRoute>} />
        <Route path="/grading" element={<ProtectedRoute><AIGradingPrototype /></ProtectedRoute>} />
        <Route path="/tutor" element={<ProtectedRoute studentOnly><StudentTutor /></ProtectedRoute>} />
        <Route path="/super-admin-login" element={<SuperAdminLogin />} />
        <Route path="/super-admin" element={<ProtectedRoute superAdminOnly><SuperAdminDashboard /></ProtectedRoute>} />
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-50">
        <AppRoutes />
      </div>
    </AuthProvider>
  );
}
