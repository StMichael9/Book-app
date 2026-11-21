import { test, expect } from "@playwright/test";
import { amazonAffiliateUrl, bookshopAffiliateUrl } from "../src/api/affiliate.js";

// Each shop's link exists only when its id is set; with neither set there is nothing to show.
const book = { title: "The Hobbit", authors: [{ name: "J.R.R. Tolkien" }] };

test("Bookshop.org needs its numeric affiliate id and a title", () => {
  expect(bookshopAffiliateUrl(book, "130585")).toBe("https://bookshop.org/search?keywords=The%20Hobbit%20J.R.R.%20Tolkien&affiliate=130585");
  expect(bookshopAffiliateUrl(book, "")).toBeNull();
  expect(bookshopAffiliateUrl(book, undefined)).toBeNull();
  expect(bookshopAffiliateUrl(book, "abc")).toBeNull();
  expect(bookshopAffiliateUrl({ title: "  " }, "130585")).toBeNull();
});

test("Amazon needs its associate tag and a title", () => {
  expect(amazonAffiliateUrl(book, "bookvane-20")).toBe("https://www.amazon.com/s?k=The%20Hobbit%20J.R.R.%20Tolkien&tag=bookvane-20");
  expect(amazonAffiliateUrl({ title: "Solo" }, "bookvane-20")).toBe("https://www.amazon.com/s?k=Solo&tag=bookvane-20");
  expect(amazonAffiliateUrl(book, "")).toBeNull();
  expect(amazonAffiliateUrl(book, undefined)).toBeNull();
  expect(amazonAffiliateUrl(book, "bad tag&x=1")).toBeNull();
  expect(amazonAffiliateUrl({ title: "" }, "bookvane-20")).toBeNull();
});

test("each shop is independent: one id gives one link, neither gives none", () => {
  const links = (bookshop, amazon) => [bookshopAffiliateUrl(book, bookshop), amazonAffiliateUrl(book, amazon)].filter(Boolean).length;
  expect(links("130585", "bookvane-20")).toBe(2);
  expect(links("130585", "")).toBe(1);
  expect(links("", "bookvane-20")).toBe(1);
  expect(links("", "")).toBe(0);
});
