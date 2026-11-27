import { ActionLink } from "./primitives.jsx";

// A link that no longer works (an expired club invite, a finished loan): the outlined spine, what happened, and one way out.
export default function DeadLink({ title, children, to, label }) {
  return <section className="bv-container"><div className="bv-dead-link">
    <span className="bv-art bv-art--empty bv-art--tall" aria-hidden="true"><i /></span>
    <h1>{title}</h1>
    <p className="bv-muted">{children}</p>
    <ActionLink to={to}>{label}</ActionLink>
  </div></section>;
}
