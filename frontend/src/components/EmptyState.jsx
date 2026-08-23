export default function EmptyState({ query, author, tag }) {
  const hasFilters = Boolean(query || author || tag);

  return (
    <div className="empty-state">
      <p>
        {hasFilters
          ? "No books match this shelf yet."
          : "Your next great read is waiting."}
      </p>
      <span>
        {hasFilters
          ? "Try a broader title, a different author, or clear a filter to browse more shelves."
          : "Start with a title, author, or tag to discover books worth keeping on your nightstand."}
      </span>
    </div>
  );
}
