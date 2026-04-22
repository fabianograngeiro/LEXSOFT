import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';

export type UserRole = 'superadmin' | 'admin' | 'defensor' | 'analista';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  org: string;
  plan: 'trial' | 'pro' | 'enterprise';
  status: 'active' | 'pending' | 'suspended';
  lastActive: string;
  expirationDate?: string;
}

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  captcha: { captchaId: string; question: string } | null;
  refreshCaptcha: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [captcha, setCaptcha] = useState<{ captchaId: string; question: string } | null>(null);

  const refreshCaptcha = async () => {
    try {
      const response = await fetch('/api/auth/captcha');
      if (response.ok) {
        const challenge = await response.json();
        setCaptcha(challenge);
      }
    } catch (err) {
      console.error('Failed to refresh captcha:', err);
    }
  };

  const refreshUser = async () => {
    const userId = localStorage.getItem('auth_user_id');
    if (!userId) {
      setUser(null);
      return;
    }

    try {
      const response = await fetch('/api/users/me', {
        headers: { 'x-user-id': userId }
      });

      if (!response.ok) {
        localStorage.removeItem('auth_user_id');
        setUser(null);
        return;
      }

      const syncedUser = await response.json();
      setUser(syncedUser);
    } catch (err) {
      console.error('Refresh failed:', err);
      setUser(null);
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      await Promise.all([refreshUser(), refreshCaptcha()]);
      setLoading(false);
    };

    bootstrap();
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        return { ok: false, error: payload.error || 'Falha no login' };
      }

      setUser(payload);
      localStorage.setItem('auth_user_id', payload.id);
      return { ok: true };
    } catch (error) {
      console.error('Login failed:', error);
      return { ok: false, error: 'Erro de conexão ao autenticar' };
    }
  };

  const logout = async () => {
    localStorage.removeItem('auth_user_id');
    setUser(null);
    await refreshCaptcha();
  };

  return (
    <AuthContext.Provider value={{ user, loading, captcha, refreshCaptcha, login, logout, refreshUser, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
