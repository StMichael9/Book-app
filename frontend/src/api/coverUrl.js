// Open Library serves each cover in S, M and L sizes. Cards show covers at most ~170 px wide, so they ask for -M;
// the one large cover on a book page asks for -L. The stored URL is never changed, only what the browser requests.
const OPEN_LIBRARY_COVER = /^(https:\/\/covers\.openlibrary\.org\/b\/[a-z0-9]+\/[^/?#]+)-[SML](\.jpg(?:\?[^#]*)?)$/i;

export function coverSrc(url, size = "medium") {
  const match = typeof url === "string" ? OPEN_LIBRARY_COVER.exec(url) : null;
  return match ? `${match[1]}-${size === "large" ? "L" : "M"}${match[2]}` : url;
}
