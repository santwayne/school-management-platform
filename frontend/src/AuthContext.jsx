import React, { createContext, useContext, useState } from 'react';
import { apiRequest } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });

  const login = async (email, password) => {
    const data = await apiRequest('/api/auth/login', { method: 'POST', body: { email, password } });
    localStorage.setItem('token', data.token);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const studentLogin = async (loginId, pin) => {
    const data = await apiRequest('/api/auth/student-login', {
      method: 'POST',
      body: { login_id: loginId, pin },
    });
    localStorage.setItem('token', data.token);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const superAdminLogin = async (email, password) => {
    const data = await apiRequest('/api/super-admin/login', { method: 'POST', body: { email, password } });
    localStorage.setItem('token', data.token);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      // Best-effort: revoke server-side so a copy left in this browser can't
      // keep renewing access. Logout itself must never block on this.
      apiRequest('/api/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => {});
    }
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, login, studentLogin, superAdminLogin, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
