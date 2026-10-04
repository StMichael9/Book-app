const affiliateId = import.meta.env.VITE_BOOKSHOP_AFFILIATE_ID;

function validIsbn13(value) {
  if (!/^\d{13}$/.test(value || "")) return false;
  const checksum = value.split("").reduce(
    (sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0,
  );
  return checksum % 10 === 0;
}

export function bookshopAffiliateUrl(book) {
  if (!/^\d+$/.test(affiliateId || "") || !validIsbn13(book?.isbn13)) return null;
  return `https://bookshop.org/a/${affiliateId}/${book.isbn13}`;
}
