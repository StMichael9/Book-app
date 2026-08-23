export default function Pagination({ page, pages, onPageChange }) {
  if (pages <= 1) return null;

  return (
    <nav className="pagination" aria-label="Pagination navigation">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button
        type="button"
        disabled={page >= pages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
