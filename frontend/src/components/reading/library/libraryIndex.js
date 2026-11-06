// Which A–Z letter a library entry sits under, the same way the server groups them for its index counts: titles by their
// folded first letter, authors by the surname of the first author. Anything else (digits, no author) is "#".
const COMBINING = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;
const letterOf = text => { const first = (text || "").charAt(0).toUpperCase(); return first >= "A" && first <= "Z" ? first : "#"; };

const titleOf = entry => entry.book?.title || entry.private_title || "";
const authorOf = entry => entry.book?.authors?.[0]?.name || entry.private_author || "";

function surname(name) {
  let text = name.normalize("NFKC").toLowerCase();
  if (text.includes(",")) text = text.split(",", 1)[0];
  const tokens = text.match(/[\p{L}\p{N}]+/gu);
  return tokens ? tokens.at(-1) : "";
}

export function entryLetter(entry, sort) {
  if (sort === "author") { const name = authorOf(entry); return name.trim() ? letterOf(surname(name)) : "#"; }
  return letterOf(titleOf(entry).normalize("NFKD").replace(COMBINING, "").toLowerCase().trim());
}

export const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];
export const letterId = letter => `bv-letter-${letter === "#" ? "other" : letter}`;
