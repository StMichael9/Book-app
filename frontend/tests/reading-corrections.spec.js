import { test as base, expect } from '@playwright/test';

// Synthetic accounts and attempt history only. These tests never call a real
// account, database, metadata provider or mail service.
const originalId = '11111111-1111-4111-8111-111111111111';
const olderId = '22222222-2222-4222-8222-222222222222';
const finished = (id, year) => ({ id, state: 'finished', started_on: `${year}-01-02`, ended_on: `${year}-02-03`,
  note: `Private note from ${year}`, reaction: 'liked', progress_value: 100, progress_unit: 'percent', total_pages: 200 });
const test = base.extend({
  app: async ({ page, baseURL }, provide) => {
    const state = { entry: { id: 101, book_id: null, book: null, private_title: 'A book with history', private_author: 'A reader',
      reading_state: 'finished', is_owned: true, is_wanted: true, version: 4 },
      attempts: [finished(originalId, 2025), finished(olderId, 2020)], requests: [], errors: [] };
    page.on('pageerror', error => state.errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(baseURL).origin) { state.errors.push('Unexpected external request'); return route.abort(); }
      if (!url.pathname.startsWith('/test-api/')) return route.continue();
      const path = url.pathname.slice(9), method = request.method();
      const body = ['POST','PUT','PATCH','DELETE'].includes(method) ? request.postDataJSON() : null;
      state.requests.push({ path, method, body });
      const reply = json => route.fulfill({ status: 200, json });
      const current = () => state.attempts.find(item => ['reading','paused'].includes(item.state)) || state.attempts[0] || null;
      if (path === '/auth/refresh') return reply({});
      if (path === '/me/reading-capabilities') return reply({ enabled: true, writable: !state.readOnly, contract_version: 1,
        features: { reading_actions: true, private_context: true, privacy_controls: true, library_import: true } });
      if (path === '/me/books' || path === '/me/preferences') return reply([]);
      if (path === '/me/library') return reply({ items: [state.entry], total: 1, next_cursor: null,
        counts: { all: 1, reading: current()?.state === 'reading' ? 1 : 0, finished: state.attempts.some(x=>x.state==='finished') ? 1 : 0, want: state.entry.is_wanted ? 1 : 0 } });
      if (path === '/me/library/101/reading') return reply({ entry: state.entry, current_attempt: current(), editions: [], imported_sources_count: 0 });
      if (path === '/me/library/101/attempts') return reply({ items: state.attempts, next_cursor: null });
      if (path.startsWith('/me/reading-attempts/')) {
        const id = path.split('/').at(-1), selected = state.attempts.find(x=>x.id===id);
        if (method === 'GET') return selected ? reply({ entry: state.entry, attempt: selected }) : route.fulfill({ status: 404, json: {} });
        if (state.holdWrite) await state.holdWrite;
        if (state.failWrite) return route.fulfill({ status: 503, json: { detail: 'Could not confirm the change.' } });
        if (body.expected_version !== state.entry.version) return route.fulfill({ status: 409, json: { detail: 'Your library changed. Reload before trying again.' } });
        if (method === 'PATCH') {
          if (body.state === 'reading' && state.attempts.some(x=>x.id!==id && ['reading','paused'].includes(x.state))) return route.fulfill({ status: 409, json: { detail: 'Another reading is active.' } });
          const { expected_version, ...changes } = body;
          Object.assign(selected, changes, body.state === 'reading' ? { ended_on: null } : {});
          state.entry.version++;
        } else if (method === 'PUT') {
          if (state.attempts.some(x=>['reading','paused'].includes(x.state))) return route.fulfill({ status: 409, json: { detail: 'Another reading is active.' } });
          state.attempts.unshift({ id, state: 'reading', started_on: '2026-10-21', ended_on: null, note: null, reaction: null, progress_value: null, progress_unit: null });
          state.entry.is_wanted = false; state.entry.version++;
        } else if (method === 'DELETE') { state.attempts = state.attempts.filter(x=>x.id!==id); state.entry.version++; }
        state.entry.reading_state = current()?.state || null;
        return reply(method === 'DELETE' ? state.entry : { entry: state.entry, attempt: current() });
      }
      state.errors.push(`Unhandled ${method} ${path}`);
      return route.fulfill({ status: 500, json: {} });
    });
    await provide(state);
    expect(state.errors).toEqual([]);
  },
});
const writes = app => app.requests.filter(x => ['PUT','PATCH','DELETE'].includes(x.method));

for (const width of [390, 1440]) test(`Undo finish reopens the same record without creating a reread at ${width}px`, async ({ page, app }) => {
  await page.setViewportSize({ width, height: 900 });
  const before = structuredClone(app.attempts);
  await page.goto('/my-books/101');
  await page.screenshot({ path: `/tmp/bookvane-reading-finished-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Undo finish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reading', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reading', exact: true })).toBeFocused();
  expect(writes(app)).toEqual([{ path: `/me/reading-attempts/${originalId}`, method: 'PATCH', body: { expected_version: 4, state: 'reading' } }]);
  expect(app.attempts).toHaveLength(2);
  expect(app.attempts[0]).toEqual({ ...before[0], state: 'reading', ended_on: null });
  expect(app.attempts[1]).toEqual(before[1]);
  expect(app.entry).toMatchObject({ id: 101, is_owned: true, is_wanted: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('reread requires explicit confirmation; Cancel and Escape make no writes and restore focus', async ({ page, app }) => {
  await page.goto('/my-books/101');
  const trigger = page.getByRole('button', { name: 'Read it again', exact: true });
  await trigger.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Start a new reading?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(trigger).toBeFocused();
  expect(writes(app)).toHaveLength(0);
  await trigger.press('Enter'); await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(writes(app)).toHaveLength(0);
  const before = structuredClone(app.attempts);
  await trigger.press('Enter');
  await page.getByRole('button', { name: 'Start a new reading', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reading', exact: true })).toBeVisible();
  expect(writes(app)).toHaveLength(1);
  expect(writes(app)[0]).toMatchObject({ method: 'PUT', body: { entry_id: 101, expected_version: 4, state: 'reading' } });
  expect(app.attempts.slice(1)).toEqual(before);
  expect(app.attempts[0].id).not.toBe(originalId);
  expect(app.entry).toMatchObject({ id: 101, is_owned: true, is_wanted: false });
});

test('mistaken active reread can be explicitly removed, then previous finish undone without losing older history', async ({ page, app }) => {
  const activeId = '33333333-3333-4333-8333-333333333333';
  const previous = structuredClone(app.attempts);
  app.attempts.unshift({ ...finished(activeId, 2026), state: 'reading', ended_on: null });
  app.entry.reading_state = 'reading';
  await page.setViewportSize({ width: 320, height: 750 });
  await page.goto('/my-books/101');
  await page.getByRole('button', { name: 'Reading history & corrections' }).click();
  await expect(page.getByText('Started a reread by mistake?', { exact: false })).toBeVisible();
  const rows = page.locator('.bv-reading-history > li');
  await rows.first().getByRole('button', { name: 'Delete this reading record' }).click();
  await expect(page.getByRole('dialog')).toContainText('Your saved book, Own/Want flags, save reason and other readings will stay.');
  await page.getByRole('button', { name: 'Keep it', exact: true }).click();
  expect(writes(app)).toHaveLength(0);
  await rows.first().getByRole('button', { name: 'Delete this reading record' }).click();
  await page.getByRole('button', { name: 'Delete reading record', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo finish', exact: true })).toBeVisible();
  expect(app.attempts).toEqual(previous);
  await page.getByRole('button', { name: 'Undo finish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reading', exact: true })).toBeVisible();
  expect(writes(app).map(x=>[x.method,x.path])).toEqual([['DELETE',`/me/reading-attempts/${activeId}`],['PATCH',`/me/reading-attempts/${originalId}`]]);
  expect(app.attempts).toHaveLength(2);
  expect(app.attempts[1]).toEqual(previous[1]);
  expect(app.entry).toMatchObject({ id: 101, is_owned: true, is_wanted: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Finished facet honestly explains an active reread without duplicating library entries', async ({ page, app }) => {
  app.entry.reading_state = 'reading';
  app.attempts.unshift({ ...finished('active', 2026), state: 'reading', ended_on: null });
  await page.goto('/my-books?status=finished');
  await expect(page.getByText('Earlier readings stay in history', { exact: false })).toBeVisible();
  await expect(page.locator('.bv-personal-book')).toHaveCount(1);
  await expect(page.locator('.bv-personal-book-state')).toContainText('Reading now');
  await expect(page.locator('.bv-personal-book-state')).toContainText('Finished before');
  await expect(page.getByRole('link', { name: 'Bring Your Library', exact: true })).toBeVisible();
  await expect(page.getByText('CSV / TSV import', { exact: true })).toBeVisible();
});

test('failed or stale reread retains visible history and captured version rather than rebasing', async ({ page, app }) => {
  await page.goto('/my-books/101');
  await page.getByRole('button', { name: 'Read it again', exact: true }).click();
  app.entry.version++;
  await page.getByRole('button', { name: 'Start a new reading', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  expect(app.attempts).toHaveLength(2);
  await page.getByRole('button', { name: 'Start a new reading', exact: true }).click();
  await expect.poll(()=>writes(app).length).toBe(2);
  expect(writes(app).every(x=>x.body.expected_version===4)).toBe(true);
  expect(writes(app)[0].path).toBe(writes(app)[1].path);
});

test('read-only workspace cannot reopen, reread or delete', async ({ page, app }) => {
  app.readOnly = true;
  await page.goto('/my-books/101');
  await expect(page.getByRole('heading', { name: 'Finished', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo finish', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Read it again', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reading history & corrections' }).click();
  await expect(page.getByRole('button', { name: 'Delete this reading record' }).first()).toBeDisabled();
  expect(writes(app)).toHaveLength(0);
});


test('a historical finished record cannot be reopened while another reading is active', async ({ page, app }) => {
  app.attempts.unshift({ ...finished('active', 2026), state: 'reading', ended_on: null });
  app.entry.reading_state = 'reading';
  await page.goto('/my-books/101');
  await page.getByRole('button', { name: 'Reading history & corrections' }).click();
  await page.locator('.bv-reading-history > li').nth(1).getByRole('button', { name: 'Correct this reading' }).click();
  await expect(page.getByRole('heading', { name: 'Selected reading' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen selected reading' })).toHaveCount(0);
  expect(writes(app)).toHaveLength(0);
});

test('failed undo retains the finished record, flags and full history', async ({ page, app }) => {
  app.failWrite = true;
  const before = structuredClone(app.attempts);
  await page.goto('/my-books/101');
  await page.getByRole('button', { name: 'Undo finish', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Finished', exact: true })).toBeVisible();
  expect(app.attempts).toEqual(before);
  expect(writes(app)).toHaveLength(1);
  expect(app.entry).toMatchObject({ is_owned: true, is_wanted: true, version: 4 });
});

test('pending reread cannot be dismissed or sent twice', async ({ page, app }) => {
  let release;
  app.holdWrite = new Promise(resolve => { release = resolve; });
  await page.goto('/my-books/101');
  await page.getByRole('button', { name: 'Read it again', exact: true }).click();
  await page.getByRole('button', { name: 'Start a new reading', exact: true }).click();
  await expect.poll(()=>writes(app).length).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Starting…', exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes(app)).toHaveLength(1);
  expect(app.attempts).toHaveLength(3);
});
