import { test, expect } from '@playwright/test';

// Real browser -> API -> disposable migrated PostgreSQL. No route mocks.
for (const width of [390, 1440]) test(`same book Finished to Reading without duplicates at ${width}px`, async ({ page }) => {
  const api = 'http://127.0.0.1:8006';
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/register?returnTo=/my-books');
  await page.getByLabel('Email address', { exact: true }).fill(`shelf-${width}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('synthetic-shelf-test-password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/my-books$/);
  const catalogue = await (await page.request.get(`${api}/books`)).json();
  const book = catalogue.items[0];
  const savedResponse = width === 390
    ? await page.request.post(`${api}/me/library/private`, { data: { request_id: crypto.randomUUID(), title: 'The Psychology of Money', is_owned: true } })
    : await page.request.put(`${api}/me/library/books/${book.id}`, { data: { is_owned: true } });
  expect(savedResponse.status()).toBe(200);
  const saved = await savedResponse.json();
  const workspace = `${api}/me/library/${saved.id}/reading`;
  await page.goto(`/my-books/${saved.id}`);
  await page.getByRole('button', { name: 'Start reading', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reading', exact: true })).toBeVisible();
  const first = (await (await page.request.get(workspace)).json()).current_attempt;
  await page.getByRole('button', { name: 'Finish book', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Finished', exact: true })).toBeVisible();
  await page.goto('/my-books?status=finished');
  await expect(page.locator('.bv-personal-book')).toHaveCount(1);
  expect((await (await page.request.get(`${api}/me/library?facet=reading`)).json()).total).toBe(0);
  await page.goto(`/my-books/${saved.id}`);
  const resume = page.getByRole('button', { name: 'Mark as reading', exact: true });
  await expect(resume).toBeVisible(); // No Manage/history disclosure needed.
  await resume.click();
  await expect(page.getByRole('heading', { name: 'Reading', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Reading', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath(`reading-after-reopen-${width}.png`), fullPage: true });
  const current = await (await page.request.get(workspace)).json();
  expect(current.entry.id).toBe(saved.id);
  expect(current.entry.is_owned).toBe(true);
  expect(current.current_attempt.id).toBe(first.id);
  expect(current.current_attempt.ended_on).toBeNull();
  expect((await (await page.request.get(`${api}/me/library/${saved.id}/attempts`)).json()).items).toHaveLength(1);
  const all = await (await page.request.get(`${api}/me/library`)).json();
  expect(all.total).toBe(1);
  expect(all.counts.reading).toBe(1);
  expect(all.counts.finished).toBe(0);
  // Reproduce the original overlap too: a real reread must retain the old
  // finish in history, but never keep a second card in the Finished shelf.
  await page.getByRole('button', { name: 'Finish book', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Finished', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Read it again', exact: true }).click();
  await page.getByRole('button', { name: 'Start a new reading', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reading', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Reading', exact: true })).toBeVisible();
  const history = (await (await page.request.get(`${api}/me/library/${saved.id}/attempts`)).json()).items;
  expect(history).toHaveLength(2);
  expect(history.find(row => row.id === first.id).state).toBe('finished');
  expect((await (await page.request.get(workspace)).json()).current_attempt.id).not.toBe(first.id);
  expect((await (await page.request.get(`${api}/me/library`)).json()).total).toBe(1);
  await page.goto('/my-books?status=reading');
  await expect(page.locator('.bv-personal-book')).toHaveCount(1);
  await page.goto('/my-books?status=finished');
  await expect(page.locator('.bv-personal-book')).toHaveCount(0);
  await expect(page.getByText('No saved books match this view.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
