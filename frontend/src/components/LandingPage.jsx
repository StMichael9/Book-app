import { useState } from "react";
import { Link } from "react-router-dom";
import { signUpForUpdates } from "../api/emailSignups.js";

const discoveryLinks = [
  { label: "Fantasy", tag: "fantasy" },
  { label: "Mystery", tag: "mystery" },
  { label: "History", tag: "history" },
  { label: "Romance", tag: "romance" },
  { label: "Science fiction", tag: "science fiction" },
];

const steps = [
  "Search freely",
  "Keep books you own",
  "Save books you want to read",
];

export default function LandingPage() {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [signupState, setSignupState] = useState("idle");
  const [signupError, setSignupError] = useState("");

  async function submitSignup(event) {
    event.preventDefault();
    if (!consent) return;
    setSignupState("submitting");
    setSignupError("");
    try {
      await signUpForUpdates(email);
      setSignupState("done");
      setEmail("");
      setConsent(false);
    } catch (error) {
      setSignupError(error.message || "Unable to sign up right now.");
      setSignupState("idle");
    }
  }

  return (
    <div className="landing-page">
      <section className="landing-page__hero" aria-labelledby="landing-title">
        <div className="landing-page__hero-copy">
          <p className="landing-page__eyebrow">A quieter way to browse</p>
          <h2 id="landing-title">
            Find your next book before you know its name.
          </h2>
          <p className="landing-page__intro">
            Search by title, author, or the feeling you want your next read to
            leave you with.
          </p>
          <Link className="landing-page__primary-link" to="/browse">
            Start exploring
          </Link>
        </div>
        <p className="landing-page__note">
          Shelfbound is a personal reading shelf for curious browsing and books
          worth keeping close.
        </p>
      </section>

      <section
        className="landing-page__section"
        aria-labelledby="discover-title"
      >
        <div className="landing-page__section-heading">
          <p className="landing-page__eyebrow">Begin somewhere</p>
          <h3 id="discover-title">Browse by a feeling</h3>
        </div>
        <nav
          className="landing-page__discovery-links"
          aria-label="Browse by genre"
        >
          {discoveryLinks.map(({ label, tag }) => (
            <Link key={tag} to={`/browse?tag=${encodeURIComponent(tag)}`}>
              {label}
              <span aria-hidden="true">&rarr;</span>
            </Link>
          ))}
        </nav>
      </section>

      <section
        className="landing-page__section landing-page__how-it-works"
        aria-labelledby="steps-title"
      >
        <div className="landing-page__section-heading">
          <p className="landing-page__eyebrow">Make it yours</p>
          <h3 id="steps-title">A shelf that follows your reading life</h3>
        </div>
        <ol className="landing-page__steps">
          {steps.map((step, index) => (
            <li key={step}>
              <span aria-hidden="true">0{index + 1}</span>
              <strong>{step}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section
        className="landing-page__closing"
        aria-labelledby="closing-title"
      >
        <h3 id="closing-title">Your next read is waiting somewhere.</h3>
        <Link className="landing-page__text-link" to="/browse">
          Explore the shelves <span aria-hidden="true">&rarr;</span>
        </Link>
      </section>

      <section className="landing-page__section" aria-labelledby="updates-title">
        <div className="landing-page__section-heading">
          <h3 id="updates-title">Hear from Bookvane</h3>
          <p>Occasional product updates. An account is not required.</p>
        </div>
        {signupState === "done" ? (
          <p role="status">Thanks for signing up for Bookvane updates.</p>
        ) : (
          <form className="preferences-form" onSubmit={submitSignup}>
            <div className="field-group">
              <label htmlFor="updates-email">Email</label>
              <input id="updates-email" type="email" autoComplete="email" required
                value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <label className="checkbox-field">
              <input type="checkbox" checked={consent} required
                onChange={(event) => setConsent(event.target.checked)} />
              <span>I agree to receive Bookvane product updates by email.</span>
            </label>
            {signupError && <p className="error-message" role="alert">{signupError}</p>}
            <button className="primary-button" type="submit" disabled={!consent || signupState === "submitting"}>
              {signupState === "submitting" ? "Signing up…" : "Sign up"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
