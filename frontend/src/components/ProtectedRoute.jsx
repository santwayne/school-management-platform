import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

export default function ProtectedRoute({ children, principalOnly = false, studentOnly = false, superAdminOnly = false }) {
  const { user } = useAuth();
  if (!user) return <Navigate to={studentOnly ? '/student-login' : superAdminOnly ? '/super-admin-login' : '/login'} replace />;
  if (principalOnly && user.role !== 'principal') return <Navigate to="/attendance" replace />;
  if (studentOnly && user.role !== 'student') return <Navigate to="/attendance" replace />;
  if (superAdminOnly && user.role !== 'super_admin') return <Navigate to="/attendance" replace />;
  return children;
}
