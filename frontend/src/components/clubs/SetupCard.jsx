import { Check } from "lucide-react";
import { Button } from "../ui-v2/primitives.jsx";
import { CHOOSE_A_BOOK, INVITE_PEOPLE, MAKE_A_READING_PLAN, SET_UP_YOUR_CLUB, STEP_CHOOSE_BOOK, STEP_INVITE, STEP_PLAN } from "./clubCopy.js";

// Set up your club (owners and admins): three steps, each ticked off as the data says it's done (nothing is stored). Only the first step still to do has
// its button. With no book yet that button is the page's primary action; once there is a book, This week already has one, so it is secondary.
export default function SetupCard({ club, current, onChooseBook, onMakePlan, onInvite }) {
  const steps = [
    { key: "book", title: STEP_CHOOSE_BOOK, done: Boolean(current), action: CHOOSE_A_BOOK, run: onChooseBook },
    { key: "plan", title: STEP_PLAN, done: Boolean(current && ((current.checkpoints || []).length > 0 || current.ends_on)), action: MAKE_A_READING_PLAN, run: onMakePlan },
    { key: "invite", title: STEP_INVITE, done: club.member_count > 1, action: INVITE_PEOPLE, run: onInvite },
  ];
  const first = steps.find(step => !step.done);
  if (!first) return null;
  return <section className="bv-club-setup" aria-labelledby="bv-club-setup-h">
    <h2 id="bv-club-setup-h" className="bv-club-label">{SET_UP_YOUR_CLUB}</h2>
    <ol className="bv-club-steps">{steps.map(step => <li key={step.key} className={step.done ? "is-done" : undefined}>
      <span className="bv-club-step-mark" aria-hidden="true">{step.done && <Check />}</span><span>{step.title}</span></li>)}</ol>
    <Button variant={current ? "secondary" : "primary"} className="bv-club-primary" onClick={first.run}>{first.action}</Button>
  </section>;
}
