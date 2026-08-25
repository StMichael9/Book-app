export default function Pagination({ page, pages, onPageChange }) {
  if (pages <= 1) return null;

  // Show up to 5 page numbers centered on the current page, trimmed to
  // stay within [1, pages]. This keeps the control usable at both small
  // page counts (12) and large ones (25+) without listing every page.
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

      {start > 1 && <span className="pagination-ellipsis">…</span>}

      {pageNumbers.map((p) => (
        <button
          key={p}
          type="button"
          className={p === page ? "pagination-current" : ""}
          aria-current={p === page ? "page" : undefined}
          onClick={() => onPageChange(p)}
        >
          {p}
        </button>
      ))}

      {end < pages && <span className="pagination-ellipsis">…</span>}

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
