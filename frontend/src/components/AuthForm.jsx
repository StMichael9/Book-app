import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../hooks/AuthContext.jsx";

export default function AuthForm({ mode }) {
  const isRegister = mode === "register";
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const returnTo = new URLSearchParams(location.search).get("returnTo") || "/browse";

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      if (isRegister) {
        await register({ email, password });
        navigate("/onboarding", { replace: true });
      } else {
        await login({ email, password });
        navigate(returnTo, { replace: true });
      }
    } catch (submitError) {
      setError(submitError.message || "Unable to complete that request.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="auth-panel">
      <p className="eyebrow">Shelfbound account</p>
      <h2>{isRegister ? "Start your shelf" : "Welcome back"}</h2>
      <p className="subtitle">
        {isRegister
          ? "Create an account to keep track of the books you own and want to read."
          : "Sign in to open your shelves and saved preferences."}
      </p>
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="field-group">
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div className="field-group">
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
            autoComplete={isRegister ? "new-password" : "current-password"}
          />
        </div>
        {error && <p className="error-message">{error}</p>}
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "Working…" : isRegister ? "Create account" : "Sign in"}
        </button>
      </form>
      <p className="auth-switch">
        {isRegister ? "Already have an account? " : "New to Shelfbound? "}
        <Link to={isRegister ? "/login" : "/register"}>
          {isRegister ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </section>
  );
}