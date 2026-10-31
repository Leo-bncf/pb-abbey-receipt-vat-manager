import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase, base44 } from '@/api/base44Client';
import { clearOfflineMail } from '@/lib/offlineMail';
import { queryClientInstance } from '@/lib/query-client';

const AuthContext = createContext();

// Invitation / password-reset links land on the site with "#...&type=invite"
// (or recovery). Capture it before supabase-js consumes and clears the hash, so
// we can ask the person to choose a password.
const INITIAL_HASH = typeof window !== 'undefined' ? window.location.hash : '';
const ARRIVED_TO_SET_PASSWORD = /type=(invite|recovery)/.test(INITIAL_HASH);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [needsPassword, setNeedsPassword] = useState(ARRIVED_TO_SET_PASSWORD);

  const loadUser = async () => {
    try {
      const u = await base44.auth.me();
      setUser(u);
      setIsAuthenticated(true);
    } catch {
      setUser(null);
      setIsAuthenticated(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      if (session) await loadUser();
      setIsLoadingAuth(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') setNeedsPassword(true);
      if (session) await loadUser();
      else { setUser(null); setIsAuthenticated(false); }
    });
    return () => { mounted = false; sub?.subscription?.unsubscribe(); };
  }, []);

  const login = async (email, password) => {
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setAuthError(error.message); throw error; }
  };

  // Set (or reset) the signed-in person's password.
  const setPassword = async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    setNeedsPassword(false);
  };

  // Email a password-reset link (works only for existing accounts; sign-up is closed).
  const requestPasswordReset = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) throw error;
  };

  const logout = async () => {
    await clearOfflineMail(); // no copy of the mailbox stays on this computer
    queryClientInstance.clear();
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, isLoadingAuth, authError, login, logout, needsPassword, setPassword, requestPasswordReset }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
