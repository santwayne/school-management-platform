import React from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './components/Login';
import AttendanceForm from './components/AttendanceForm';
import PrincipalDashboard from './components/PrincipalDashboard';
import FinanceAdmin from './components/FinanceAdmin';
import AIGradingPrototype from './components/AIGradingPrototype';
import StudentLogin from './components/StudentLogin';
import TutorChat from './components/TutorChat';
import SuperAdminLogin from './components/SuperAdminLogin';
import SuperAdminDashboard from './components/SuperAdminDashboard';
import ClassManager from './components/ClassManager';
import SyllabusManager from './components/SyllabusManager';

function NavBar() {
  const { user, logout } = useAuth();
  if (!user) return null;

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
        <Link to="/attendance" className="hover:text-indigo-600">Attendance</Link>
        {user.role === 'principal' && (
          <>
            <Link to="/dashboard" className="hover:text-indigo-600">Dashboard</Link>
            <Link to="/finance" className="hover:text-indigo-600">Finance</Link>
            <Link to="/classes" className="hover:text-indigo-600">Classes</Link>
            <Link to="/syllabus" className="hover:text-indigo-600">Syllabus</Link>
          </>
        )}
        <Link to="/grading" className="hover:text-indigo-600">AI Grading</Link>
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
  return <Navigate to="/attendance" replace />;
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <NavBar />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/student-login" element={<StudentLogin />} />
        <Route path="/attendance" element={<ProtectedRoute><AttendanceForm /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute principalOnly><PrincipalDashboard /></ProtectedRoute>} />
        <Route path="/finance" element={<ProtectedRoute principalOnly><FinanceAdmin /></ProtectedRoute>} />
        <Route path="/classes" element={<ProtectedRoute principalOnly><ClassManager /></ProtectedRoute>} />
        <Route path="/syllabus" element={<ProtectedRoute principalOnly><SyllabusManager /></ProtectedRoute>} />
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
