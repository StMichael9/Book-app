import { Link } from "react-router-dom";

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
    </div>
  );
}
