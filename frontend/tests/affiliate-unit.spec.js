import { test, expect } from "@playwright/test";
import { bookshopAffiliateUrl } from "../src/api/affiliate.js";

// The Bookshop.org link exists only when its id is set.
const book = { title: "The Hobbit", authors: [{ name: "J.R.R. Tolkien" }] };

test("Bookshop.org needs its numeric affiliate id and a title", () => {
  expect(bookshopAffiliateUrl(book, "130585")).toBe("https://bookshop.org/search?keywords=The%20Hobbit%20J.R.R.%20Tolkien&affiliate=130585");
  expect(bookshopAffiliateUrl(book, "")).toBeNull();
  expect(bookshopAffiliateUrl(book, undefined)).toBeNull();
  expect(bookshopAffiliateUrl(book, "abc")).toBeNull();
  expect(bookshopAffiliateUrl({ title: "  " }, "130585")).toBeNull();
});
