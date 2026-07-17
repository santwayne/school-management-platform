import React from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './components/Login';
import TeacherPortal from './components/TeacherPortal';
import PrincipalDashboard from './components/PrincipalDashboard';
import FinanceAdmin from './components/FinanceAdmin';
import AIGradingPrototype from './components/AIGradingPrototype';
import TutorChat from './components/TutorChat';
import SuperAdminLogin from './components/SuperAdminLogin';
import SuperAdminDashboard from './components/SuperAdminDashboard';
import ClassManager from './components/ClassManager';
import SyllabusManager from './components/SyllabusManager';
import AdminAttendance from './components/AdminAttendance';
import ClassNotesComposer from './components/ClassNotesComposer';
import StaffBroadcast from './components/StaffBroadcast';
import AdminPayroll from './components/AdminPayroll';
import AdminTransport from './components/AdminTransport';

// Pages ported to the new Waynur design bring their own header/nav chrome —
// stacking the old NavBar on top of them would double up navigation.
const SELF_CHROME_PREFIXES = ['/teacher'];

function NavBar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  if (!user) return null;
  if (SELF_CHROME_PREFIXES.some((p) => location.pathname.startsWith(p))) return null;

  if (user.role === 'student') {
    return (
      <nav className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex gap-6 text-sm font-medium text-gray-700">
          <Link to="/tutor" className="hover:text-indigo-600">Ask for Help</Link>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span>{user.name}</span>
          <button onClick={logout} className="text-indigo-600 font-medium hover:text-indigo-800">Log out</button>
        </div>
      </nav>
    );
  }

  return (
    <nav className="bg-white border-b px-6 py-3 flex items-center justify-between">
      <div className="flex gap-6 text-sm font-medium text-gray-700">
        <Link to="/teacher" className="hover:text-indigo-600">Teacher Portal</Link>
        {user.role === 'principal' && (
          <>
            <Link to="/dashboard" className="hover:text-indigo-600">Dashboard</Link>
            <Link to="/finance" className="hover:text-indigo-600">Finance</Link>
            <Link to="/classes" className="hover:text-indigo-600">Classes</Link>
            <Link to="/syllabus" className="hover:text-indigo-600">Syllabus</Link>
            <Link to="/admin/attendance" className="hover:text-indigo-600">Attendance</Link>
          </>
        )}
        <Link to="/grading" className="hover:text-indigo-600">AI Grading</Link>
        <Link to="/class-notes" className="hover:text-indigo-600">Class Notes</Link>
            {user.role === 'principal' && <Link to="/staff-broadcast" className="hover:text-indigo-600">Staff Broadcast</Link>}
            {user.role === 'principal' && <Link to="/admin/payroll" className="hover:text-indigo-600">Payroll</Link>}
            {user.role === 'principal' && <Link to="/admin/transport" className="hover:text-indigo-600">Transport</Link>}
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
  if (user.role === 'student') return <Navigate to="/tutor" replace />;
  if (user.role === 'super_admin') return <Navigate to="/super-admin" replace />;
  return <Navigate to="/teacher" replace />;
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
        <Route path="/grading" element={<ProtectedRoute><AIGradingPrototype /></ProtectedRoute>} />
        <Route path="/tutor" element={<ProtectedRoute studentOnly><TutorChat /></ProtectedRoute>} />
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
