// Every reader-facing word on the landing page, in one place. Michael approved the order and every answer (21 Nov 2026).
// Nothing that is not live goes on the page: each LIVE flag stays false until that feature ships, and gated lines render only when it is true.
export const LIVE = { switchPage: false, lending: false, clubs: false, patron: false, clubPlus: false };

export const COPY = {
  title: "Bookvane: a private reading tracker you scan with your phone",
  description: "Free, private reading tracker. Scan book barcodes with your phone, import from Goodreads or StoryGraph, and keep your notes to yourself.",
  hero: { heading: "Your reading life, kept private.", line: "Scan the books on your shelf with your phone. Free forever, with nothing public unless you choose.", create: "Create a free account", browse: "Browse books first", quiet: "No card. No feed. Nothing public by default." },
  signedIn: { explore: "Explore books", library: "Return to your library" },
  scan: { heading: "Scan a stack in a minute.", line: "Point your phone at the barcode on the back of each book. Add them all at once as books you own or want to read.", small: "Works in your phone’s browser. On a computer, type an ISBN instead.", cta: "Scan your first books" },
  library: { heading: "Moving from Goodreads or StoryGraph?", line: "Upload your export and check the matches before anything is saved. Your books and shelves come with you.", cta: "Bring your library over" },
  priv: { heading: "Only you can see your notes.", line: "No public reviews, no feed, no follower counts. Your notes, reactions and private books stay yours.", ai: "Your notes and reactions are never used with paid AI services.", link: "How we handle your data" },
  track: { heading: "Keep your place, and your thoughts.", line: "Log the date and page, write a note as you go, and answer “How was it?” when you finish." },
  paid: {
    heading: "Free, and honest about money.",
    line: "Bookvane is free forever. Here’s how it’s paid for, and none of it is selling your reading.",
    items: [
      { key: "patron", title: "Patron", text: "Readers who want to support Bookvane can become Patrons." },
      { key: "links", title: "Book links", text: "Some book links go to Bookshop.org. If you buy, Bookvane may earn a small commission, at no cost to you. Each link says so." },
      { key: "clubPlus", title: "Club Plus", text: "Reading clubs can add Club Plus for extra club features." },
    ],
    link: "Read how we handle your data",
  },
  faqHeading: "Questions",
  final: { heading: "Start your shelf.", line: "It takes about a minute." },
  alt: {
    scan: "The Bookvane scan sheet on a phone, with a barcode inside the aiming box.",
    scanned: "The scan sheet after three books: “Added · 3 scanned” and the “Add 3 books” button.",
    aim: "The aiming box over the barcode on the back of a book.",
    tick: "A tick showing a barcode was read and the book was found.",
    add: "The “Add 3 books” button under the list of scanned books.",
    library: "The import screen listing the matched books for you to check before anything is saved.",
    note: "A private note on a book, with the line “Only you can see this”.",
    thumbs: "The “How was it?” question with a private reaction.",
    track: "The reading page with the page and date logged and a progress bar.",
  },
};

// The brief's answers, in order. `needs` names a LIVE flag the answer depends on; a missing flag drops only that sentence, never the answer.
const FAQ_PAY = ["Bookvane is free to use. It’s paid for by", "a small commission on some Bookshop.org links if you buy"];
export function faqItems(live = LIVE) {
  const payers = [live.patron && "readers who choose to be Patrons", FAQ_PAY[1], live.clubPlus && "Club Plus for reading clubs"].filter(Boolean);
  const list = payers.length > 1 ? `${payers.slice(0, -1).join(", ")}, and ${payers[payers.length - 1]}` : payers[0];
  return [
    { q: "How is Bookvane free?", a: `${FAQ_PAY[0]} ${list}. We don’t show ads.` },
    { q: "What happens to my data?", a: "We keep your email, a password we can’t read, and the books, dates, notes and reactions you save. Only you can see your notes, reactions and private books, and they aren’t used with paid AI services. Our team looks at stored data only to help you or keep Bookvane safe. Hosting, storage and email run on Render, Neon and Resend.", link: true },
    { q: "Do you sell my data?", a: "No." },
    { q: "Can I take my data with me?", a: "Yes. Download everything from Your reading data, including a full backup file. We don’t keep a copy of the download." },
    { q: "Can I delete my data?", a: "You can delete a reading or a whole book from My Books. To delete your account, email support@bookvane.me. Deleted data can stay in backups for a limited time." },
    { q: "Is anything public?", a: "Only what you choose: a public profile and lists you decide to share. Notes, ratings, dates and shelf statuses are never public." },
    { q: "Does the scan work on my computer?", a: "The camera scan is for phones. On a computer you can type an ISBN." },
    { q: "What if a book isn’t found?", a: "It’s still saved as a private entry, so you don’t lose it." },
    { q: "Which files can I import?", a: "Goodreads and StoryGraph exports, or a spreadsheet (CSV)." },
    { q: "Do I need an account to look around?", a: "No. Browse and search freely; you need a free account to save." },
    { q: "What are Bookshop.org links?", a: "Some books link to Bookshop.org. If you buy, Bookvane may earn a small commission at no cost to you. Each link says so, and none sits above your own shelf buttons." },
  ];
}
export const paidItems = (live = LIVE) => COPY.paid.items.filter(item => item.key === "links" || live[item.key]);
