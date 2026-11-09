// Plain-words labels for an edition row: Open Library sends language paths ("/languages/eng") and formats with
// uneven spelling ("E-book", "eBook"). Unknown languages are left out rather than shown as a code or a path.
const LANGUAGES = {
  eng: "English", en: "English", fre: "French", fra: "French", fr: "French", ger: "German", deu: "German", de: "German",
  spa: "Spanish", es: "Spanish", ita: "Italian", it: "Italian", por: "Portuguese", pt: "Portuguese", dut: "Dutch", nld: "Dutch", nl: "Dutch",
  rus: "Russian", ru: "Russian", jpn: "Japanese", ja: "Japanese", chi: "Chinese", zho: "Chinese", zh: "Chinese", kor: "Korean", ko: "Korean",
  ara: "Arabic", ar: "Arabic", heb: "Hebrew", he: "Hebrew", hin: "Hindi", hi: "Hindi", lat: "Latin", la: "Latin", gre: "Greek", ell: "Greek", el: "Greek",
  swe: "Swedish", sv: "Swedish", nor: "Norwegian", no: "Norwegian", dan: "Danish", da: "Danish", fin: "Finnish", fi: "Finnish",
  pol: "Polish", pl: "Polish", tur: "Turkish", tr: "Turkish", cze: "Czech", ces: "Czech", cs: "Czech", hun: "Hungarian", hu: "Hungarian",
  ukr: "Ukrainian", uk: "Ukrainian", rum: "Romanian", ron: "Romanian", ro: "Romanian", yor: "Yoruba", ibo: "Igbo", hau: "Hausa", swa: "Swahili", sw: "Swahili",
};
const FORMATS = { ebook: "E-book", hardcover: "Hardcover", hardback: "Hardcover", paperback: "Paperback", audiobook: "Audiobook", audio: "Audiobook" };

export function languageName(value) {
  if (typeof value !== "string") return "";
  const code = value.trim().toLowerCase().split("/").filter(Boolean).pop() || "";
  return LANGUAGES[code] || "";
}

export function formatName(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const text = value.trim();
  return FORMATS[text.toLowerCase().replace(/[\s_-]+/g, "")] || text[0].toUpperCase() + text.slice(1);
}

// One option per distinct label; variants of the same copy collapse into the first.
export function editionOptions(editions) {
  const seen = new Set(), out = [];
  for (const edition of editions || []) {
    const languages = [...new Set((edition.languages || []).map(languageName).filter(Boolean))];
    const parts = [formatName(edition.physical_format) || "Edition"];
    if (edition.page_count) parts.push(`${edition.page_count} pages`);
    if (languages.length) parts.push(languages.join(", "));
    const label = parts.join(" · ");
    if (seen.has(label)) continue;
    seen.add(label); out.push({ id: edition.id, label });
  }
  return out;
}
