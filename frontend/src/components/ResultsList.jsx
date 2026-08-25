import BookCard from "./BookCard.jsx";
import EmptyState from "./EmptyState.jsx";

export default function ResultsList({
  books,
  loading,
  error,
  query,
  author,
  tags,
}) {
  if (error) {
    return <p className="error-message">{error}</p>;
  }

  if (loading) {
    return <div className="loading-state">Loading books…</div>;
  }

  if (books.length === 0) {
    return <EmptyState query={query} author={author} tags={tags} />;
  }

  return (
    <section className="book-grid" aria-label="Book results">
      {books.map((book) => (
        <BookCard key={book.id} book={book} />
      ))}
    </section>
  );
}
