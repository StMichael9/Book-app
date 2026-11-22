const affiliateId = import.meta.env?.VITE_BOOKSHOP_AFFILIATE_ID;

const keywordsFor = book => {
  const title = (book?.title || "").trim();
  if (!title) return null;
  const author = book.authors?.[0]?.name?.trim();
  return encodeURIComponent(author ? `${title} ${author}` : title);
};

export function bookshopAffiliateUrl(book, id = affiliateId) {
  const keywords = keywordsFor(book);
  if (!/^\d+$/.test(id || "") || !keywords) return null;
  return `https://bookshop.org/search?keywords=${keywords}&affiliate=${id}`;
}
