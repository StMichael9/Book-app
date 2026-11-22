import { formatDay } from "../reading/readingDates.js";

export const day = value => formatDay(value, { journal: true });

// The first open loan of each direction; the lent card comes first.
export const orderLoans = loans => [...loans].sort((a, b) => (a.direction === b.direction ? 0 : a.direction === "lent" ? -1 : 1));

export const who = loan => (loan.direction === "lent" ? `Lent to ${loan.person_name}` : `Borrowed from ${loan.person_name}`);

export function sinceLine(loan) {
  if (loan.direction === "lent" && loan.said_back) return `Lent to ${loan.person_name} since ${day(loan.started_on)}`;
  const due = loan.due_on ? ` · ${loan.direction === "lent" ? "due back" : "give back by"} ${day(loan.due_on)}` : "";
  return `since ${day(loan.started_on)}${due}`;
}

export const pastLine = loan => `${who(loan)} · ${day(loan.started_on)} – ${day(loan.ended_on)}`;

export const sendMessage = (name, url) => `Hi ${name}! Here’s the book I lent you: ${url}`;
export const remindMessage = (name, title, url) => `Hi ${name}! Just a gentle reminder about ${title}. Whenever it’s back with me, you can tap “I’ve given it back” here: ${url}`;
