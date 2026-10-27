import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  loginUser,
  logoutUser,
  refreshSession,
  registerUser,
} from "../api/auth.js";
import { clearBookCache, rememberSignedIn } from "../api/bookCache.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionError, setSessionError] = useState(null);
  const sessionVersion = useRef(0);
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const startupRefresh = useRef(null);

  useEffect(() => {
    const handleSessionExpired = () => {
      clearBookCache();
      sessionVersion.current += 1;
      setSessionGeneration(sessionVersion.current);
      setIsAuthenticated(false);
      setIsLoading(false);
      setSessionError(null);
    };
    window.addEventListener("bookvane:session-expired", handleSessionExpired);
    return () => window.removeEventListener("bookvane:session-expired", handleSessionExpired);
  }, []);

  const checkSession = useCallback(() => {
    const version = ++sessionVersion.current;
    setSessionGeneration(version);
    const isCurrent = () => version === sessionVersion.current;
    setIsLoading(true);
    setSessionError(null);
    const pending = refreshSession();
    startupRefresh.current = pending;
    return pending
      .then(() => {
        if (isCurrent()) {
          setIsAuthenticated(true);
          setIsLoading(false);
        }
      })
      .catch(error => {
        if (!isCurrent()) return;
        if (error.status === 401) {
          clearBookCache("member"); // a signed-in copy must not outlive its session; the guest copy stays
          setIsAuthenticated(false);
          setIsLoading(false);
        } else {
          // Unknown account state is not a guest session. Keep protected
          // content/actions gated and offer retry rather than silent logout.
          setSessionError("We couldn’t reach the server. Your saved books haven’t changed.");
        }
      });
  }, []);

  useEffect(() => {
    checkSession();
    return () => { sessionVersion.current += 1; };
  }, [checkSession]);

  // Once the account check has answered, remember only the yes/no, so the next landing can paint before it returns.
  useEffect(() => { if (!isLoading) rememberSignedIn(isAuthenticated); }, [isAuthenticated, isLoading]);

  const value = useMemo(
    () => ({
      isAuthenticated,
      isLoading,
      sessionError,
      sessionGeneration,
      retrySession: checkSession,
      async login(credentials) {
        clearBookCache();
        // A startup refresh belongs to the previous session state. Its late
        // response must not override an explicit login or registration.
        const version = ++sessionVersion.current;
        setSessionGeneration(version);
        setSessionError(null);
        try {
          // Finish the older cookie-writing response before issuing new
          // cookies. Ignoring its React callback alone cannot protect cookies.
          await startupRefresh.current?.catch(() => {});
          await loginUser(credentials);
          if (version === sessionVersion.current) setIsAuthenticated(true);
        } finally {
          if (version === sessionVersion.current) setIsLoading(false);
        }
      },
      async register(credentials) {
        clearBookCache();
        const version = ++sessionVersion.current;
        setSessionGeneration(version);
        setSessionError(null);
        try {
          await startupRefresh.current?.catch(() => {});
          await registerUser(credentials);
          await loginUser(credentials);
          if (version === sessionVersion.current) setIsAuthenticated(true);
        } finally {
          if (version === sessionVersion.current) setIsLoading(false);
        }
      },
      async logout() {
        clearBookCache();
        sessionVersion.current += 1;
        setSessionGeneration(sessionVersion.current);
        await logoutUser();
        setIsAuthenticated(false);
        // A full navigation prevents a ProtectedRoute redirect from racing
        // the logout transition and leaving the user on a return-to-login URL.
        window.location.replace("/");
      },
    }),
    [isAuthenticated, isLoading, sessionError, sessionGeneration, checkSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
