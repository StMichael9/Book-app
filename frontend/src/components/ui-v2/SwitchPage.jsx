import { useEffect } from "react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { ActionLink } from "./primitives.jsx";
import { setMeta } from "./bookSeo.js";
import "../../styles/ui-v2/switch.css";

// /switch: a public page for people leaving Goodreads or StoryGraph. Every word is on this page so the copy can change without touching the layout.
const SWITCH_COPY = {
  title: "Move from Goodreads or StoryGraph to Bookvane",
  description: "Bring your shelves, reading dates and notes to Bookvane in three steps. Private by default.",
  heading: "Leaving Goodreads or StoryGraph?",
  lede: "Bring your library with you. Your shelves, reading dates and notes come across, and everything stays private to you.",
  button: "Start your import",
  login: "Bookvane never asks for your Goodreads login.",
  stepsHeading: "Three steps",
  steps: [
    ["Export your library", "Goodreads: My Books, then Import and Export. StoryGraph: Manage Account, then Export StoryGraph Library."],
    ["Upload the file", "Up to 20,000 books. You’ll see a summary before anything is added."],
    ["Check and finish", "Choose a match for any book we’re unsure about. Then your shelves are ready."],
  ],
  acrossHeading: "What comes across",
  across: ["Your shelves: read, reading and want to read", "Books you own", "Start and finish dates, including re-reads", "Your reviews and notes come along too, kept with the book"],
  closing: "Ready when you are.",
};

export default function SwitchPage() {
  const auth = useAuth();
  // The import needs an account: signed out, sign up first (the source is carried), then straight to the import.
  const target = auth.isAuthenticated ? "/my-books/import" : `/register?${new URLSearchParams({ src: "switch", returnTo: "/my-books/import" })}`;
  useEffect(() => {
    const undo = [setMeta("name", "description", SWITCH_COPY.description), setMeta("property", "og:title", `${SWITCH_COPY.title} · Bookvane`), setMeta("property", "og:description", SWITCH_COPY.description)];
    return () => undo.forEach(restore => restore());
  }, []);
  return <section className="bv-container bv-leave">
    <div className="bv-leave-column">
      <h1>{SWITCH_COPY.heading}</h1>
      <p className="bv-leave-lede">{SWITCH_COPY.lede}</p>
      <ActionLink to={target}>{SWITCH_COPY.button}</ActionLink>
      <p className="bv-leave-small">{SWITCH_COPY.login}</p>
      <section className="bv-leave-block" aria-labelledby="bv-leave-steps">
        <h2 id="bv-leave-steps">{SWITCH_COPY.stepsHeading}</h2>
        <ol className="bv-leave-steps" role="list">{SWITCH_COPY.steps.map(([title, text]) => <li key={title}><strong>{title}</strong><span>{text}</span></li>)}</ol>
      </section>
      <section className="bv-leave-block" aria-labelledby="bv-leave-across">
        <h2 id="bv-leave-across">{SWITCH_COPY.acrossHeading}</h2>
        <ul className="bv-leave-across">{SWITCH_COPY.across.map(line => <li key={line}>{line}</li>)}</ul>
      </section>
      <aside className="bv-leave-close"><p>{SWITCH_COPY.closing}</p><ActionLink to={target}>{SWITCH_COPY.button}</ActionLink></aside>
    </div>
  </section>;
}
