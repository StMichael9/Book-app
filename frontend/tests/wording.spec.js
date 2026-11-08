import { test, expect } from "@playwright/test";
import { editionOptions, formatName, languageName } from "../src/components/reading/editionLabels.js";

test("edition languages read as names, and an unknown code is left out, never shown as a path", () => {
  expect(languageName("/languages/eng")).toBe("English");
  expect(languageName("eng")).toBe("English");
  expect(languageName("fre")).toBe("French");
  expect(languageName("/languages/zzz")).toBe("");
  expect(languageName(null)).toBe("");
  const [one] = editionOptions([{ id: 1, physical_format: "Paperback", page_count: 320, languages: ["/languages/eng", "/languages/zzz"] }]);
  expect(one.label).toBe("Paperback · 320 pages · English");
  const [bare] = editionOptions([{ id: 2, physical_format: "Hardcover", languages: ["/languages/zzz"] }]);
  expect(bare.label).toBe("Hardcover");
  expect(bare.label).not.toMatch(/languages|zzz|not listed/i);
});

test("E-book, eBook and e-book are one format, and the copies they name are listed once", () => {
  for (const variant of ["E-book", "eBook", "e-book", "EBOOK", "E book"]) expect(formatName(variant)).toBe("E-book");
  expect(formatName("")).toBe("");
  const rows = editionOptions([
    { id: 1, physical_format: "E-book", languages: ["eng"] },
    { id: 2, physical_format: "eBook", languages: ["/languages/eng"] },
    { id: 3, physical_format: "ebook", languages: ["eng"] },
    { id: 4, physical_format: "Paperback", page_count: 300, languages: ["eng"] },
  ]);
  expect(rows.map(row => row.label)).toEqual(["E-book · English", "Paperback · 300 pages · English"]);
  expect(rows[0].id).toBe(1);
});
