export default function Hero() {
  return (
    <section className="hero-panel">
      <div className="hero-copy">
        <p className="eyebrow">Find your next read</p>
        <h2>Search by title, author, or the mood you want to live inside.</h2>
        <p className="subtitle">
          A bookstore-style reader discovery space that narrows results as you
          browse.
        </p>
      </div>

      <aside className="hero-card">
        <p className="card-label">This week’s shelf</p>
        <ul>
          <li>Fantasy</li>
          <li>Quiet thrillers</li>
          <li>Literary fiction</li>
        </ul>
      </aside>
    </section>
  );
}
