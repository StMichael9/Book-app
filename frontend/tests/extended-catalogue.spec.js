import { test as base, expect } from '@playwright/test';

const external = { source_id: '/works/OL1W', title: 'The missing chapter', author: 'Fixture author', cover_image_url: null, snapshot: 'pinned' };
const entry = { id: 44, book_id: null, book: null, private_title: external.title, private_author: external.author,
  private_catalogue: { source: 'openlibrary', work_id: external.source_id, snapshot: 'pinned', cover_image_url: null },
  is_owned: false, is_wanted: true, version: 1, reading_state: null, save_note: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };

const appEntry = state => state.cover ? { ...entry, private_catalogue: { ...entry.private_catalogue, cover_image_url: '/fixture-cover.svg' } } : entry;

const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { requests: [], errors: [], enabled: true, authenticated: true, localItems: [{ id: 1, title: "Existing Neon choice", authors: [], tags: [] }], items: [external] };
    page.on('pageerror', error => state.errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === "https://covers.openlibrary.org") return route.abort(); // cover art in the book snapshot; never a data request
      if (url.origin !== new URL(baseURL).origin) { state.errors.push('Unexpected external request'); return route.abort(); }
      if (url.pathname === '/fixture-cover.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#263d34"/></svg>' });
      if (!url.pathname.startsWith('/test-api/')) return route.continue();
      const path = url.pathname.slice(9);
      state.requests.push({ path, method: request.method(), body: request.method()==='POST' ? request.postDataJSON() : null });
      const reply = json => route.fulfill({ status: 200, json });
      const currentEntry = appEntry(state);
      if (path === "/events") return route.fulfill({ status: 204, body: "" });
      if (path === '/auth/refresh') return state.authenticated ? reply({}) : route.fulfill({ status: 401, json: {} });
      if (path === '/me/reading-capabilities') { if (state.holdCapabilities) await state.holdCapabilities; if (state.failCapabilities) return route.fulfill({ status: 503, json: {} }); return reply({ enabled: true, writable: state.writable !== false, contract_version: 1, features: { reading_actions: true, extended_catalogue: state.enabled, library_import: true, next_read: Boolean(state.nextRead) } }); }
      if (path === '/books/more') return reply([]);
      if (path === '/me/books' || path === '/me/preferences' || path.startsWith('/autocomplete/')) return reply([]);
      if (path === '/books') { if (state.holdLocal) await state.holdLocal; return reply({ items: state.localItems, total: state.localItems.length, page: 1, size: 20 }); }
      if (path === '/me/library/lookup') return reply({ items: request.postDataJSON().book_ids.map(id => ({ book_id: id, entry_id: null, is_owned: false, is_wanted: false, version: null })) });
      if (path === '/me/catalogue/search') { if (state.holdExtended) await state.holdExtended; return reply({ items: state.malformed ? 'wrong shape' : state.unavailable ? [] : state.items, available: !state.unavailable, more_available: false }); }
      if (path === '/me/catalogue/select') return state.failSelect ? route.fulfill({ status: 503, json: { detail: 'Could not save this selection.' } }) : reply(currentEntry);
      if (path === '/auth/logout' || path === '/auth/login') { state.authenticated = path === '/auth/login'; return reply({}); }
      if (path === '/me/next-read') return reply({ items: url.searchParams.getAll('exclude').includes('entry:44') ? [] : [{ key: 'entry:44', entry_id: 44, version: 1, private_title: currentEntry.private_title, private_author: currentEntry.private_author, private_catalogue: currentEntry.private_catalogue, reasons: [{ code: 'want' }] }], eligible_count: 1, remaining_count: 1, interests: [], known_page_count: 0 });
      if (path === '/me/home') return reply({ current_reads: [], reading_count: 0, paused_count: 0 });
      if (path === '/me/up-next') return route.fulfill({ status: 404, json: { detail: 'Not found' } });
      if (path === '/me/library-imports') return reply({ items: [] });
      if (path === '/me/library') return reply({ items: state.showLibrary ? [currentEntry] : [], total: state.showLibrary ? 1 : 0, counts: {}, next_cursor: null });
      if (path === '/me/library/44/reading') return reply({ entry: currentEntry, current_attempt: null, editions: [], imported_sources_count: 0 });
      if (path === '/me/library/44/attempts') return reply({ items: [], next_cursor: null });
      // Cards prefetch their book when seen; these fixtures hold no book pages, so the prefetch is answered with a quiet 404.
      if (/^\/books\/\d+$/.test(path)) return route.fulfill({ status: 404, json: { detail: "Not found" } });
      if (/^\/(books|me\/library)\/\d+\/description$/.test(path) || /^\/me\/library-imports\/[^/]+\/enrichment$/.test(path)) return route.fulfill({ status: 404, json: { detail: "Not found" } });
      if (path === "/me/profile") return route.fulfill({ status: 200, json: { display_name: null, bio: null, initials: "R", handle: null, profile_public: false, show_prompt: false, reading_since: 2026 } });
      if (path === "/me/stats") return route.fulfill({ status: 200, json: { year: 2026, books_finished: 0, pages_read: 0, by_month: Array(12).fill(0), top_genres: [], biggest_month: null } });
      if (path === "/me/lists") return route.fulfill({ status: 200, json: [] });
      state.errors.push(`Unhandled ${path}`); return route.fulfill({ status: 500, json: {} });
    });
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});

test('manual fallback keeps bibliographic input and distinguishes CSV import', async ({ page, app }) => {
  await page.goto('/browse?book=My%20missing%20title&author=Someone');
  await page.getByRole('link', { name: 'Add a book' }).click();
  await expect(page.getByRole('heading', { name: 'Add a book' })).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('My missing title');
  await expect(page.getByLabel('Author (optional)')).toHaveValue('Someone');
  await expect(page.getByRole('link', { name: 'Back to search' })).toHaveAttribute('href', '/browse?book=My%20missing%20title&author=Someone');
  expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain('My missing title');
  await page.getByRole('link', { name: 'Import from Goodreads or StoryGraph', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import from Goodreads or StoryGraph' })).toBeVisible();
  await expect(page.locator('#import-file')).toHaveAttribute('accept', '.csv,.tsv,text/csv,text/tab-separated-values');
  await page.locator('#import-file').setInputFiles({ name: 'library.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('not an accepted CSV') });
  await expect(page.getByText('Save or export your spreadsheet as CSV or TSV first.', { exact: false })).toBeVisible();
  expect(app.requests.filter(x => x.path === '/me/library-imports/inspect')).toHaveLength(0);
});

test('prefill is document-only and cannot survive an account switch', async ({ page, app }) => {
  await page.goto('/browse?book=Private%20query&author=Reader');
  await page.getByRole('link', { name: 'Add a book' }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Private query');
  const oldState = await page.evaluate(() => history.state);
  app.authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event('bookvane:session-expired')));
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Email address', { exact: true }).fill('different@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('NotARealPassword123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('link', { name: 'Your profile', exact: true })).toBeVisible();
  await page.evaluate(state => { history.pushState(state, '', '/my-books/private'); dispatchEvent(new PopStateEvent('popstate', { state })); }, oldState);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Author (optional)')).toHaveValue('');
});


test('document reload drops the optional manual prefill without persisting a private draft', async ({ page, app: _app }) => {
  await page.goto('/browse?book=An%20unsaved%20title');
  await page.getByRole('link', { name: 'Add a book' }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('An unsaved title');
  expect(await page.evaluate(() => JSON.stringify([localStorage,sessionStorage]))).not.toContain('An unsaved title');
  await page.reload();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('');
});


test('with the extended catalogue off, an empty search offers a prefilled private book', async ({ page, app }) => {
  app.enabled = false; app.localItems = [];
  await page.goto('/browse?book=My%20missing%20title');
  await expect(page.getByRole('heading', { name: 'No books found.', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Add it to your library yourself', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a book' })).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('My missing title');
  await expect(page.getByRole('link', { name: 'Back to search' })).toHaveAttribute('href', '/browse?book=My%20missing%20title');
  expect(app.requests.filter(x => x.path === '/me/catalogue/search')).toHaveLength(0);
});

test('the missing-book action is hidden for read-only and signed-out readers', async ({ page, app }) => {
  app.enabled = false; app.localItems = []; app.writable = false;
  await page.goto('/browse?book=My%20missing%20title');
  await expect(page.getByRole('heading', { name: 'No books found.', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add it to your library yourself' })).toHaveCount(0);
  app.authenticated = false; app.writable = true;
  await page.evaluate(() => window.dispatchEvent(new Event('bookvane:session-expired')));
  await page.goto('/browse?book=My%20missing%20title');
  await expect(page.getByRole('heading', { name: 'No books found.', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add it to your library yourself' })).toHaveCount(0);
});
