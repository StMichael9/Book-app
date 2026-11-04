// Open Library serves each cover through two redirects to archive.org, which takes 0.5–1.5 s. Covers are therefore
// requested from wsrv.nl, a free image cache on Cloudflare's network: it fetches the Open Library -L image once, resizes it
// to WebP and serves later requests from a nearby copy. coverFallback is the direct Open Library URL, used if the cache
// fails. The stored URL is never changed, only what the browser requests.
const OPEN_LIBRARY_COVER = /^https:\/\/(covers\.openlibrary\.org\/b\/[a-z0-9]+\/[^/?#]+)-[SML](\.jpg)(?:\?[^#]*)?$/i;
const WIDTH = { medium: 360, large: 600 };

export function coverSrc(url, size = "medium") {
  const match = typeof url === "string" ? OPEN_LIBRARY_COVER.exec(url) : null;
  if (!match) return url;
  const source = encodeURIComponent(`${match[1]}-L${match[2]}`);
  return `https://wsrv.nl/?url=${source}&w=${WIDTH[size] || WIDTH.medium}&we&output=webp&q=80`;
}

export function coverFallback(url, size = "medium") {
  const match = typeof url === "string" ? OPEN_LIBRARY_COVER.exec(url) : null;
  return match ? `https://${match[1]}-${size === "large" ? "L" : "M"}${match[2]}` : null;
}
