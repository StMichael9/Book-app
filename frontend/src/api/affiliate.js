const affiliateId = import.meta.env?.VITE_BOOKSHOP_AFFILIATE_ID;
const associateTag = import.meta.env?.VITE_AMAZON_ASSOCIATE_TAG;

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

// An Amazon Associates search link for the book, only when the associate tag is set (VITE_AMAZON_ASSOCIATE_TAG).
export function amazonAffiliateUrl(book, tag = associateTag) {
  const keywords = keywordsFor(book);
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(tag || "") || !keywords) return null;
  return `https://www.amazon.com/s?k=${keywords}&tag=${encodeURIComponent(tag)}`;
}
