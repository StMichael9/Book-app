import { createContext, useContext, useEffect, useMemo, useState } from "react";

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

  useEffect(() => {
    let active = true;

    refreshSession()
      .then(() => {
        if (active) setIsAuthenticated(true);
      })
      .catch(() => {
        if (active) setIsAuthenticated(false);
      })
      .finally(() => {
        if (active) setIsLoading(false);
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
        await loginUser(credentials);
        setIsAuthenticated(true);
      },
      async register(credentials) {
        await registerUser(credentials);
        await loginUser(credentials);
        setIsAuthenticated(true);
      },
      async logout() {
        try {
          await logoutUser();
        } finally {
          setIsAuthenticated(false);
        }
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