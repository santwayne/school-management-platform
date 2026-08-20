import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

function homeFor(role) {
  if (role === 'student') return '/student';
  if (role === 'super_admin') return '/super-admin';
  if (role === 'accountant') return '/accountant/fee-collection';
  if (role === 'librarian') return '/admin/library';
  if (role === 'principal') return '/dashboard';
  return '/teacher'; // teachers land on the Teacher Portal by default
}

export default function ProtectedRoute({ children, principalOnly = false, studentOnly = false, superAdminOnly = false, teacherOrPrincipalOnly = false, accountantOnly = false, financeOnly = false, libraryOnly = false }) {
  const { user } = useAuth();
  if (!user) return <Navigate to={superAdminOnly ? '/super-admin-login' : '/login'} replace />;
  if (principalOnly && user.role !== 'principal') return <Navigate to={homeFor(user.role)} replace />;
  if (studentOnly && user.role !== 'student') return <Navigate to={homeFor(user.role)} replace />;
  if (superAdminOnly && user.role !== 'super_admin') return <Navigate to={homeFor(user.role)} replace />;
  if (teacherOrPrincipalOnly && !['teacher', 'principal'].includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  if (accountantOnly && user.role !== 'accountant') return <Navigate to={homeFor(user.role)} replace />;
  if (financeOnly && !['principal', 'accountant'].includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  if (libraryOnly && !['principal', 'librarian'].includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}
