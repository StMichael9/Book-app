import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../hooks/AuthContext.jsx";

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div className="loading-state">Checking your Shelfbound session…</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  }

  return children;
}