import { test as base, expect } from '@playwright/test';

const external = { source_id: '/works/OL1W', title: 'The missing chapter', author: 'Fixture author', cover_image_url: null, snapshot: 'pinned' };
const entry = { id: 44, book_id: null, book: null, private_title: external.title, private_author: external.author,
  private_catalogue: { source: 'openlibrary', work_id: external.source_id, snapshot: 'pinned', cover_image_url: null },
  is_owned: false, is_wanted: true, version: 1, reading_state: null, save_note: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { requests: [], errors: [], enabled: true };
    page.on('pageerror', error => state.errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(baseURL).origin) { state.errors.push('Unexpected external request'); return route.abort(); }
      if (!url.pathname.startsWith('/test-api/')) return route.continue();
      const path = url.pathname.slice(9);
      state.requests.push({ path, method: request.method(), body: request.method()==='POST' ? request.postDataJSON() : null });
      const reply = json => route.fulfill({ status: 200, json });
      if (path === '/auth/refresh') return reply({});
      if (path === '/me/reading-capabilities') return reply({ enabled: true, writable: true, contract_version: 1, features: { reading_actions: true, extended_catalogue: state.enabled } });
      if (path === '/me/books' || path === '/me/preferences' || path.startsWith('/autocomplete/')) return reply([]);
      if (path === '/books') return reply({ items: [{ id: 1, title: 'Existing Neon choice', authors: [], tags: [] }], total: 1, page: 1, size: 20 });
      if (path === '/me/library/lookup') return reply({ items: request.postDataJSON().book_ids.map(id => ({ book_id: id, entry_id: null, is_owned: false, is_wanted: false, version: null })) });
      if (path === '/me/catalogue/search') return reply({ items: state.malformed ? 'wrong shape' : state.unavailable ? [] : [external], available: !state.unavailable, more_available: false });
      if (path === '/me/catalogue/select') return reply(entry);
      if (path === '/me/library/44/reading') return reply({ entry, current_attempt: null, editions: [], imported_sources_count: 0 });
      if (path === '/me/library/44/attempts') return reply({ items: [], next_cursor: null });
      state.errors.push(`Unhandled ${path}`); return route.fulfill({ status: 500, json: {} });
    });
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});

test('automatic lookup preserves Neon and confirms before private selection', async ({ page, app }) => {
  await page.goto('/browse?book=missing');
  await expect(page.getByRole('heading', { name: 'Existing Neon choice' })).toBeVisible();
  await expect(page.getByRole('heading', { name: external.title, exact: true })).toBeVisible();
  expect(app.requests.filter(x => x.path === '/me/catalogue/select')).toHaveLength(0);
  await page.getByRole('button', { name: 'Review this book' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(app.requests.filter(x => x.path === '/me/catalogue/select')).toHaveLength(0);
  await page.getByRole('button', { name: 'Review this book' }).click();
  await page.getByRole('button', { name: 'Confirm and open' }).click();
  await expect(page).toHaveURL(/my-books\/44$/);
  await expect(page.getByRole('heading', { name: external.title, exact: true })).toBeVisible();
  const commands = app.requests.filter(x => x.path === '/me/catalogue/select');
  expect(commands).toHaveLength(1);
  expect(commands[0].body).toMatchObject({ source_id: external.source_id, confirmed: true });
  expect(commands[0].body).not.toHaveProperty('token');
});

test('outage keeps Neon results and manual fallback', async ({ page, app }) => {
  app.unavailable = true;
  await page.goto('/browse?book=missing');
  await expect(page.getByRole('heading', { name: 'Existing Neon choice' })).toBeVisible();
  await expect(page.getByText('More books are temporarily unavailable. Your existing library is unchanged.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add a private book' })).toBeVisible();
});

test('off feature makes no catalogue requests', async ({ page, app }) => {
  app.enabled = false;
  await page.goto('/browse?book=missing');
  await expect(page.getByRole('heading', { name: 'Existing Neon choice' })).toBeVisible();
  expect(app.requests.filter(x => x.path.startsWith('/me/catalogue/'))).toHaveLength(0);
});

test('subject filters never silently include unclassified external results', async ({ page, app }) => {
  await page.goto('/browse?book=missing&tag=fantasy');
  await expect(page.getByRole('heading', { name: 'Existing Neon choice' })).toBeVisible();
  expect(app.requests.filter(x => x.path.startsWith('/me/catalogue/'))).toHaveLength(0);
});

test('malformed results fail closed without crashing or hiding Neon', async ({ page, app }) => {
  app.malformed = true;
  await page.goto('/browse?book=missing');
  await expect(page.getByRole('heading', { name: 'Existing Neon choice' })).toBeVisible();
  await expect(page.getByText('More books are temporarily unavailable. Your existing library is unchanged.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review this book' })).toHaveCount(0);
});

test('phone layout and keyboard confirmation stay accessible', async ({ page, app }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/browse?book=missing');
  await page.getByRole('button', { name: 'Review this book' }).click();
  await expect(page.getByRole('dialog', { name: 'Is this your book?' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Review this book' })).toBeFocused();
  expect(app.requests.filter(x => x.path === '/me/catalogue/select')).toHaveLength(0);
});
