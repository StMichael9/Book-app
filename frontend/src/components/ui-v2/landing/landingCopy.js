// Every reader-facing word on the landing page, in one place. Michael approved the order and the answers (21 Nov 2026) and the review's
// edits (22 Nov). Nothing that is not live goes on the page: each LIVE flag stays false until that feature ships, and gated lines render
// only when it is true.
export const LIVE = { switchPage: true, lending: false, clubs: false, patron: false, clubPlus: false };

export const COPY = {
  title: "Bookvane: a private reading tracker you scan with your phone",
  description: "Free to use, private reading tracker. Scan book barcodes with your phone, import from Goodreads or StoryGraph, and keep your notes to yourself.",
  hero: { heading: "Your reading life, kept private.", line: "Scan the barcodes on your books with your phone. Free to use, and private unless you choose to share.", create: "Create a free account", browse: "Browse books first" },
  signedIn: { explore: "Explore books", library: "Return to your library", line: "Your books are right where you left them." },
  scan: { heading: "Scan a stack of books at once.", line: "Point your phone at the barcode on the back of each book. Add them all as books you own or want to read.", small: "Works in your phone’s browser. On a computer, type an ISBN instead.", cta: "Scan your first books" },
  library: { heading: "Moving from Goodreads or StoryGraph?", line: "Upload a Goodreads or StoryGraph export, or a spreadsheet. Check the matches before anything is saved. Your books and shelves come with you.", cta: "Bring your library over" },
  priv: { heading: "Only you can see your notes.", line: "Log the date and page, write a note as you go, and answer “How was it?” when you finish. None of it is public: no reviews, no feed, no follower counts.", ai: "Your notes and reactions are never sent to AI services.", link: "How we handle your data" },
  paid: { heading: "How Bookvane is paid for", link: "How we handle your data" },
  faqHeading: "Questions",
  final: { heading: "Start your shelf." },
  alt: {
    scan: "The Scan books sheet: a barcode inside the aiming box with a green tick, a card reading Added, 3 scanned, and the scanned books with their covers listed below.",
    library: "The import review asks which Alice’s Adventures in Wonderland is yours, with two editions and their covers to choose from.",
    note: "A book page for A Room of One’s Own: page 64 of 128, the line “Only you can see your notes.”, a saved note, and the days read.",
  },
};;

// The money paragraph. Patron and Club Plus add one plain sentence each, only when live.
export function paidText(live = LIVE) {
  return [
    "Bookvane is free to use.",
    live.patron && "Readers who want to support Bookvane can become Patrons.",
    "Some book links go to Bookshop.org. If you buy, Bookvane may earn a small commission, at no cost to you, and each link says so.",
    live.clubPlus && "Reading clubs can add Club Plus for extra club features.",
    "We don’t show ads, and we don’t sell your data.",
  ].filter(Boolean).join(" ");
}

// Six answers, in the order that builds trust. A missing flag drops only that sentence, never the answer.
export function faqItems(live = LIVE) {
  const payers = [live.patron && "readers who choose to be Patrons", "a small commission on some Bookshop.org links if you buy", live.clubPlus && "Club Plus for reading clubs"].filter(Boolean);
  const list = payers.length > 1 ? `${payers.slice(0, -1).join(", ")}, and ${payers[payers.length - 1]}` : payers[0];
  return [
    { q: "How is Bookvane free?", a: `Bookvane is free to use. It’s paid for by ${list}. We don’t show ads.` },
    { q: "Do you sell my data?", a: "No." },
    { q: "What happens to my data?", a: "We keep your email, a password we can’t read, and the books, dates, notes and reactions you save. Only you can see your notes, reactions and private books, and they are never sent to AI services. Our team looks at stored data only to help you or keep Bookvane safe. Hosting, storage and email run on Render, Neon and Resend.", link: true },
    { q: "Is anything public?", a: "Only what you choose: a public profile and lists you decide to share. Notes, ratings, dates and shelf statuses are never public." },
    { q: "Can I take my data or delete it?", a: "Yes. Download everything from Your reading data, including a full backup file. You can delete a reading or a whole book from My Books, and email support@bookvane.me to delete your account. Deleted data can stay in backups for a limited time." },
    { q: "What if a book isn’t found?", a: "It’s still saved as a private entry, so you don’t lose it." },
  ];
}
