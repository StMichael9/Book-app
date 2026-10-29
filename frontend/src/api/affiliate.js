const affiliateId = import.meta.env.VITE_BOOKSHOP_AFFILIATE_ID;

export function bookshopAffiliateUrl(book) {
  const title = (book?.title || "").trim();
  if (!/^\d+$/.test(affiliateId || "") || !title) return null;
  const author = book.authors?.[0]?.name?.trim();
  const keywords = encodeURIComponent(author ? `${title} ${author}` : title);
  return `https://bookshop.org/search?keywords=${keywords}&affiliate=${affiliateId}`;
}
