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
      if (url.origin !== new URL(baseURL).origin) { state.errors.push('Unexpected external request'); return route.abort(); }
      if (url.pathname === '/fixture-cover.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#263d34"/></svg>' });
      if (!url.pathname.startsWith('/test-api/')) return route.continue();
      const path = url.pathname.slice(9);
      state.requests.push({ path, method: request.method(), body: request.method()==='POST' ? request.postDataJSON() : null });
      const reply = json => route.fulfill({ status: 200, json });
      const currentEntry = appEntry(state);
      if (path === '/auth/refresh') return state.authenticated ? reply({}) : route.fulfill({ status: 401, json: {} });
      if (path === '/me/reading-capabilities') { if (state.holdCapabilities) await state.holdCapabilities; if (state.failCapabilities) return route.fulfill({ status: 503, json: {} }); return reply({ enabled: true, writable: true, contract_version: 1, features: { reading_actions: true, extended_catalogue: state.enabled, library_import: true, next_read: Boolean(state.nextRead) } }); }
      if (path === '/me/books' || path === '/me/preferences' || path.startsWith('/autocomplete/')) return reply([]);
      if (path === '/books') { if (state.holdLocal) await state.holdLocal; return reply({ items: state.localItems, total: state.localItems.length, page: 1, size: 20 }); }
      if (path === '/me/library/lookup') return reply({ items: request.postDataJSON().book_ids.map(id => ({ book_id: id, entry_id: null, is_owned: false, is_wanted: false, version: null })) });
      if (path === '/me/catalogue/search') { if (state.holdExtended) await state.holdExtended; return reply({ items: state.malformed ? 'wrong shape' : state.unavailable ? [] : state.items, available: !state.unavailable, more_available: false }); }
      if (path === '/me/catalogue/select') return state.failSelect ? route.fulfill({ status: 503, json: { detail: 'Could not save this selection.' } }) : reply(currentEntry);
      if (path === '/auth/logout' || path === '/auth/login') { state.authenticated = path === '/auth/login'; return reply({}); }
      if (path === '/me/next-read') return reply({ items: url.searchParams.getAll('exclude').includes('entry:44') ? [] : [{ key: 'entry:44', entry_id: 44, version: 1, private_title: currentEntry.private_title, private_author: currentEntry.private_author, private_catalogue: currentEntry.private_catalogue, reasons: [{ code: 'want' }] }], eligible_count: 1, remaining_count: 1, interests: [], known_page_count: 0 });
      if (path === '/me/home') return reply({ current_reads: [], reading_count: 0, paused_count: 0 });
      if (path === '/me/library-imports') return reply({ items: [] });
      if (path === '/me/library') return reply({ items: state.showLibrary ? [currentEntry] : [], total: state.showLibrary ? 1 : 0, counts: {}, next_cursor: null });
      if (path === '/me/library/44/reading') return reply({ entry: currentEntry, current_attempt: null, editions: [], imported_sources_count: 0 });
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
  await expect(page.getByText('More books are temporarily unavailable.', { exact: false })).toBeVisible();
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
  await expect(page.getByText('More books are temporarily unavailable.', { exact: false })).toBeVisible();
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


test('local search completes first, then additional loading replaces premature no-match', async ({ page, app }) => {
  let releaseLocal, releaseExtended;
  app.localItems = [];
  app.holdLocal = new Promise(resolve => { releaseLocal = resolve; });
  app.holdExtended = new Promise(resolve => { releaseExtended = resolve; });
  await page.goto('/browse?book=missing');
  await expect(page.locator('.bv-results-heading').getByText('Loading books…')).toBeVisible();
  expect(app.requests.filter(x => x.path === '/me/catalogue/search')).toHaveLength(0);
  releaseLocal();
  await expect(page.getByText('Checking more books…')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No books found.' })).toHaveCount(0);
  releaseExtended();
  await expect(page.getByRole('heading', { name: external.title, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No books found.' })).toHaveCount(0);
});

test('both sources empty has one honest final empty state', async ({ page, app }) => {
  app.localItems = []; app.items = [];
  await page.goto('/browse?book=missing');
  await expect(page.getByRole('heading', { name: 'No books found.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add a private book' })).toBeVisible();
});

test('failed A selection cannot leak its error into B confirmation', async ({ page, app }) => {
  app.items = [external, { ...external, source_id: '/works/OL2W', title: 'Another missing book' }];
  app.failSelect = true;
  await page.goto('/browse?book=missing');
  await page.getByRole('button', { name: 'Review this book' }).first().click();
  await page.getByRole('button', { name: 'Confirm and open' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  const firstId = app.requests.find(x => x.path === '/me/catalogue/select').body.request_id;
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Review this book' }).nth(1).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Another missing book' })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm and open' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  const commands = app.requests.filter(x => x.path === '/me/catalogue/select');
  expect(commands).toHaveLength(2);
  expect(commands[1].body.request_id).not.toBe(firstId);
});

test('manual fallback keeps bibliographic input and distinguishes CSV import', async ({ page, app }) => {
  await page.goto('/browse?book=My%20missing%20title&author=Someone');
  await page.getByRole('link', { name: 'Add a private book' }).click();
  await expect(page.getByRole('heading', { name: 'Add one book manually' })).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('My missing title');
  await expect(page.getByLabel('Author (optional)')).toHaveValue('Someone');
  await expect(page.getByRole('link', { name: 'Back to search' })).toHaveAttribute('href', '/browse?book=My%20missing%20title&author=Someone');
  expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain('My missing title');
  await page.getByRole('link', { name: 'Bring Your Library', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bring Your Library' })).toBeVisible();
  await expect(page.locator('#import-file')).toHaveAttribute('accept', '.csv,.tsv,text/csv,text/tab-separated-values');
  await page.locator('#import-file').setInputFiles({ name: 'library.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('not an accepted CSV') });
  await expect(page.getByText('Save or export your spreadsheet as CSV or TSV first.', { exact: false })).toBeVisible();
  expect(app.requests.filter(x => x.path === '/me/library-imports/inspect')).toHaveLength(0);
});

test('prefill is document-only and cannot survive an account switch', async ({ page, app }) => {
  await page.goto('/browse?book=Private%20query&author=Reader');
  await page.getByRole('link', { name: 'Add a private book' }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Private query');
  const oldState = await page.evaluate(() => history.state);
  app.authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event('bookvane:session-expired')));
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Email address', { exact: true }).fill('different@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('NotARealPassword123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('link', { name: 'Your account', exact: true })).toBeVisible();
  await page.evaluate(state => { history.pushState(state, '', '/my-books/private'); dispatchEvent(new PopStateEvent('popstate', { state })); }, oldState);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Author (optional)')).toHaveValue('');
});


test('selected private cover survives the integrated workspace, library and Next Read factories', async ({ page, app }) => {
  app.cover = true; app.showLibrary = true; app.nextRead = true;
  await page.goto('/browse?book=missing');
  await page.getByRole('button', { name: 'Review this book' }).click();
  await page.getByRole('button', { name: 'Confirm and open' }).click();
  const cover = page.getByRole('img', { name: `Cover of ${external.title}`, exact: true });
  await expect(cover).toHaveAttribute('src', '/fixture-cover.svg');
  await page.goto('/my-books');
  await expect(cover).toHaveAttribute('src', '/fixture-cover.svg');
  await page.goto('/home');
  await expect(page.getByRole('region', { name: 'Choose your next read' }).getByRole('img', { name: `Cover of ${external.title}`, exact: true })).toHaveAttribute('src', '/fixture-cover.svg');
});

test('document reload drops the optional manual prefill without persisting a private draft', async ({ page, app: _app }) => {
  await page.goto('/browse?book=An%20unsaved%20title');
  await page.getByRole('link', { name: 'Add a private book' }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('An unsaved title');
  expect(await page.evaluate(() => JSON.stringify([localStorage,sessionStorage]))).not.toContain('An unsaved title');
  await page.reload();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('');
});


for (const enabled of [true, false]) test(`slow capabilities cannot show a premature final empty state; lookup=${enabled}`, async ({ page, app }) => {
  let release;
  app.enabled = enabled; app.localItems = [];
  app.holdCapabilities = new Promise(resolve => { release = resolve; });
  await page.goto('/browse?book=missing');
  await expect(page.getByText('Finishing your search…')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No books found.' })).toHaveCount(0);
  expect(app.requests.filter(x=>x.path==='/me/catalogue/search')).toHaveLength(0);
  release();
  if (enabled) {
    await expect(page.getByRole('heading', { name: external.title, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No books found.' })).toHaveCount(0);
  } else {
    await expect(page.getByRole('heading', { name: 'No books found.' })).toBeVisible();
    expect(app.requests.filter(x=>x.path==='/me/catalogue/search')).toHaveLength(0);
  }
});

test('failed capability check does not claim that an additional catalogue was searched', async ({ page, app }) => {
  app.failCapabilities = true; app.localItems = [];
  await page.goto('/browse?book=missing');
  await expect(page.getByText('Additional books couldn’t be checked.', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No books found.' })).toHaveCount(0);
  expect(app.requests.filter(x=>x.path==='/me/catalogue/search')).toHaveLength(0);
});
