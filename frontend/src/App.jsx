import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './components/Login';
import TeacherPortal from './components/TeacherPortal';
import PrincipalDashboard from './components/PrincipalDashboard';
import AdminHome from './components/AdminHome';
import AccountantHome from './components/AccountantHome';
import SuperAdminHome from './components/SuperAdminHome';
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
import StudentHome from './components/StudentHome';
import AdminReports from './components/AdminReports';
import AdminSettings from './components/AdminSettings';
import AdminCommunications from './components/AdminCommunications';
import AdminBilling from './components/AdminBilling';
import FeeCollectionHub from './components/FeeCollectionHub';
import StudentHomework from './components/StudentHomework';
import StudentNotes from './components/StudentNotes';
import StudentProgress from './components/StudentProgress';
import StudentRewards from './components/StudentRewards';
import AdminShell from './components/AdminShell';
import AccountantShell from './components/AccountantShell';
import SuperAdminShell from './components/SuperAdminShell';

// Every role now has its own sidebar shell (matches the approved Lovable
// designs) — Admin/Accountant/Student/Super Admin pages render inside their
// shell, wrapped once here so individual page components stay shell-agnostic.
// Teacher Portal intentionally has no shell — it's the deliberately minimal
// WhatsApp-first surface, not meant to carry the full sidebar chrome.
const inShell = (Shell, Page) => (
  <Shell>
    <Page />
  </Shell>
);

function homeFor(role) {
  if (role === 'student') return '/student';
  if (role === 'super_admin') return '/super-admin';
  if (role === 'accountant') return '/accountant';
  return '/teacher';
}

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homeFor(user.role)} replace />;
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/student-login" element={<Navigate to="/login" replace />} />

        <Route path="/teacher" element={<ProtectedRoute teacherOrPrincipalOnly><TeacherPortal /></ProtectedRoute>} />

        <Route path="/dashboard" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminHome)}</ProtectedRoute>} />
        <Route path="/dashboard-alerts" element={<ProtectedRoute principalOnly>{inShell(AdminShell, PrincipalDashboard)}</ProtectedRoute>} />
        <Route path="/finance" element={<ProtectedRoute principalOnly>{inShell(AdminShell, FinanceAdmin)}</ProtectedRoute>} />
        <Route path="/classes" element={<ProtectedRoute principalOnly>{inShell(AdminShell, ClassManager)}</ProtectedRoute>} />
        <Route path="/syllabus" element={<ProtectedRoute principalOnly>{inShell(AdminShell, SyllabusManager)}</ProtectedRoute>} />
        <Route path="/admin/attendance" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminAttendance)}</ProtectedRoute>} />
        <Route path="/staff-broadcast" element={<ProtectedRoute principalOnly>{inShell(AdminShell, StaffBroadcast)}</ProtectedRoute>} />
        <Route path="/admin/payroll" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminPayroll)}</ProtectedRoute>} />
        <Route path="/admin/transport" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminTransport)}</ProtectedRoute>} />
        <Route path="/admin/settings" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminSettings)}</ProtectedRoute>} />
        <Route path="/admin/communications" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminCommunications)}</ProtectedRoute>} />
        <Route path="/admin/billing" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminBilling)}</ProtectedRoute>} />
        <Route path="/admin/reports" element={<ProtectedRoute financeOnly>{inShell(AdminShell, AdminReports)}</ProtectedRoute>} />
        <Route path="/accountant/reports" element={<ProtectedRoute accountantOnly>{inShell(AccountantShell, AdminReports)}</ProtectedRoute>} />
        <Route path="/grading" element={<ProtectedRoute>{inShell(AdminShell, AIGradingPrototype)}</ProtectedRoute>} />
        <Route path="/class-notes" element={<ProtectedRoute teacherOrPrincipalOnly>{inShell(AdminShell, ClassNotesComposer)}</ProtectedRoute>} />

        <Route path="/accountant" element={<ProtectedRoute accountantOnly>{inShell(AccountantShell, AccountantHome)}</ProtectedRoute>} />
        <Route path="/accountant/fee-collection" element={<ProtectedRoute accountantOnly>{inShell(AccountantShell, FeeCollectionHub)}</ProtectedRoute>} />
        <Route path="/accountant/payroll" element={<ProtectedRoute accountantOnly>{inShell(AccountantShell, AdminPayroll)}</ProtectedRoute>} />

        <Route path="/student" element={<ProtectedRoute studentOnly><StudentHome /></ProtectedRoute>} />
        <Route path="/tutor" element={<ProtectedRoute studentOnly><StudentTutor /></ProtectedRoute>} />
        <Route path="/homework" element={<ProtectedRoute studentOnly><StudentHomework /></ProtectedRoute>} />
        <Route path="/notes" element={<ProtectedRoute studentOnly><StudentNotes /></ProtectedRoute>} />
        <Route path="/progress" element={<ProtectedRoute studentOnly><StudentProgress /></ProtectedRoute>} />
        <Route path="/rewards" element={<ProtectedRoute studentOnly><StudentRewards /></ProtectedRoute>} />

        <Route path="/super-admin-login" element={<SuperAdminLogin />} />
        <Route path="/super-admin" element={<ProtectedRoute superAdminOnly>{inShell(SuperAdminShell, SuperAdminHome)}</ProtectedRoute>} />
        <Route path="/super-admin/schools" element={<ProtectedRoute superAdminOnly>{inShell(SuperAdminShell, SuperAdminDashboard)}</ProtectedRoute>} />

        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-cream">
        <AppRoutes />
      </div>
    </AuthProvider>
  );
}
