export default function Pagination({ page, pages, onPageChange }) {
  if (pages <= 1) return null;

  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  let end = Math.min(pages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  const pageNumbers = [];
  for (let p = start; p <= end; p++) pageNumbers.push(p);

  return (
    <nav className="pagination" aria-label="Pagination navigation">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(1)}
        aria-label="First page"
      >
        « First
      </button>
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        ‹ Previous
      </button>

      {start > 1 && <span>…</span>}

      <div className="pagination-numbers">
        {pageNumbers.map((p) => (
          <button
            key={p}
            type="button"
            aria-current={p === page ? "page" : undefined}
            onClick={() => onPageChange(p)}
          >
            {p}
          </button>
        ))}
      </div>

      {end < pages && <span>…</span>}

      <button
        type="button"
        disabled={page >= pages}
        onClick={() => onPageChange(page + 1)}
      >
        Next ›
      </button>
      <button
        type="button"
        disabled={page >= pages}
        onClick={() => onPageChange(pages)}
        aria-label="Last page"
      >
        Last »
      </button>
    </nav>
  );
}
