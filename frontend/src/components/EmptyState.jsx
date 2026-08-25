export default function EmptyState({ query, author, tags = [] }) {
  const hasFilters = Boolean(query || author || tags.length > 0);

  return (
    <div className="empty-state">
      <p>
        {hasFilters
          ? "No books match that search yet."
          : "Your next great read is waiting."}
      </p>
      <span>
        {hasFilters
          ? "Try a broader title, a different author, fewer tags, or clear a filter to browse more books."
          : "Start with a title, author, or tag to discover books worth keeping on your nightstand."}
      </span>
    </div>
  );
}
