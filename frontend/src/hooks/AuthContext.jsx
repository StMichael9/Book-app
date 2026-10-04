import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  loginUser,
  logoutUser,
  refreshSession,
  registerUser,
} from "../api/auth.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const sessionVersion = useRef(0);
  const startupRefresh = useRef(null);

  useEffect(() => {
    const handleSessionExpired = () => {
      sessionVersion.current += 1;
      setIsAuthenticated(false);
      setIsLoading(false);
    };
    window.addEventListener("bookvane:session-expired", handleSessionExpired);
    return () => window.removeEventListener("bookvane:session-expired", handleSessionExpired);
  }, []);

  useEffect(() => {
    let active = true;
    const version = sessionVersion.current;
    const isCurrent = () => active && version === sessionVersion.current;

    startupRefresh.current = refreshSession();
    startupRefresh.current
      .then(() => {
        if (isCurrent()) setIsAuthenticated(true);
      })
      .catch(() => {
        if (isCurrent()) setIsAuthenticated(false);
      })
      .finally(() => {
        if (isCurrent()) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(
    () => ({
      isAuthenticated,
      isLoading,
      async login(credentials) {
        // A startup refresh belongs to the previous session state. Its late
        // response must not override an explicit login or registration.
        const version = ++sessionVersion.current;
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
        const version = ++sessionVersion.current;
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
        sessionVersion.current += 1;
        await logoutUser();
        setIsAuthenticated(false);
        // A full navigation prevents a ProtectedRoute redirect from racing
        // the logout transition and leaving the user on a return-to-login URL.
        window.location.replace("/");
      },
    }),
    [isAuthenticated, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
