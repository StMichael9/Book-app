import { useState } from "react";
import { Link } from "react-router-dom";
import { requestPasswordReset, resetPassword } from "../api/auth.js";

export default function PasswordRecoveryPage({ reset = false }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const token = reset ? new URLSearchParams(window.location.hash.slice(1)).get("token") : null;

  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      if (reset) {
        if (!token) throw new Error("This reset link is missing its token.");
        await resetPassword(token, password);
        window.history.replaceState(null, "", window.location.pathname);
        setMessage("Password updated. Please sign in again.");
      } else {
        await requestPasswordReset(email);
        setMessage("If that account exists, a reset link will be sent.");
      }
    } catch (requestError) {
      setError(requestError.message || "Unable to complete this request.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="auth-panel">
      <h1>{reset ? "Choose a new password" : "Reset your password"}</h1>
      {message ? (
        <p role="status">{message} <Link to="/login">Sign in</Link></p>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <div className="field-group">
            <label htmlFor="recovery-input">{reset ? "New password" : "Email"}</label>
            <input
              id="recovery-input"
              type={reset ? "password" : "email"}
              autoComplete={reset ? "new-password" : "email"}
              minLength={reset ? 8 : undefined}
              maxLength={reset ? 128 : undefined}
              required
              value={reset ? password : email}
              onChange={(event) => reset ? setPassword(event.target.value) : setEmail(event.target.value)}
            />
          </div>
          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={pending || (reset && !token)}>
            {pending ? "Working…" : reset ? "Update password" : "Send reset link"}
          </button>
        </form>
      )}
      <p className="auth-switch"><Link to="/login">Back to sign in</Link></p>
    </section>
  );
}
