import { test, expect } from "@playwright/test";
import { acceptScan, createRepeatGuard, isbn13Valid, typedIsbn } from "../src/components/reading/scan/decoder.js";
import { isSaveable, rowFromAnswer } from "../src/components/reading/scan/scanList.js";

// Pure logic of the scan sheet: which codes are accepted, how typed ISBNs are read, the repeat window and what a lookup answer means for a row.
test("only 978 and 979 codes with a good check digit are accepted", () => {
  expect(acceptScan("9780141439518")).toBe(true);
  expect(acceptScan("9780141439519")).toBe(false);            // wrong check digit
  expect(acceptScan("5012345678900")).toBe(false);            // a shop code, not an ISBN
  expect(acceptScan("978014143951")).toBe(false);             // too short
  expect(acceptScan("97801414395180")).toBe(false);           // too long
  expect(acceptScan("978014143951X")).toBe(false);
  expect(acceptScan(undefined)).toBe(false);
  expect(acceptScan("9790000000001")).toBe(true);           // 979 is an ISBN prefix too
  expect(isbn13Valid("5012345678900")).toBe(true);            // a good EAN-13 is not enough on its own
});

test("typed ISBNs: hyphens and spaces are ignored and an ISBN-10 becomes an ISBN-13", () => {
  expect(typedIsbn("978-0-14-143951-8")).toBe("9780141439518");
  expect(typedIsbn(" 9780141439518 ")).toBe("9780141439518");
  expect(typedIsbn("0-14-143951-3")).toBe("9780141439518");
  expect(typedIsbn("080442957X")).toBe("9780804429573");
  expect(typedIsbn("0141439519")).toBeNull();
  expect(typedIsbn("9780141439519")).toBeNull();
  expect(typedIsbn("hello")).toBeNull();
  expect(typedIsbn("")).toBeNull();
});

test("the same ISBN is ignored for three seconds, then counts again; another ISBN is never held back", () => {
  let clock = 1000;
  const guard = createRepeatGuard(3000, () => clock);
  expect(guard("9780141439518")).toBe(true);
  clock += 2999; expect(guard("9780141439518")).toBe(false);
  expect(guard("9780743273565")).toBe(true);
  clock += 1; expect(guard("9780141439518")).toBe(true);      // three seconds after the first accepted scan: the window has passed
  clock += 2999; expect(guard("9780141439518")).toBe(false);
});

test("a lookup answer becomes one of the row states", () => {
  const card = { title: "Emma", authors: ["Jane Austen"], cover_url: "https://x/c.jpg" };
  expect(rowFromAnswer({ status: "catalogue", book_id: 7, on_shelf: null, ...card })).toMatchObject({ state: "found", bookId: 7, title: "Emma" });
  expect(rowFromAnswer({ status: "catalogue", book_id: 7, on_shelf: { is_owned: true, is_wanted: false }, ...card }).state).toBe("on_shelf");
  expect(rowFromAnswer({ status: "open_library", book_id: null, on_shelf: null, ...card })).toMatchObject({ state: "found", bookId: null, title: "Emma" });
  for (const status of ["not_found", "unavailable"]) expect(rowFromAnswer({ status, book_id: null, title: null, authors: [], cover_url: null, on_shelf: null }).state).toBe("not_found");
  expect(["found", "not_found"].every(state => isSaveable({ state }))).toBe(true);
  expect(["on_shelf", "looking", "waiting", "failed"].some(state => isSaveable({ state }))).toBe(false);
});
