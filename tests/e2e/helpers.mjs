// Shared by the end-to-end flows: a signed-in page, navigation, and checks
// that every API call the screens made was accepted.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';

export const BASE = process.env.E2E_URL || 'http://127.0.0.1:5190';
const PSQL = process.env.PSQL || 'su postgres -c';

export function sql(statement) {
  const [command, ...args] = PSQL.split(' ');
  return execFileSync(command, [...args, `psql -X -q -t -A -d lltest -c "${statement.replace(/"/g, '\\"')}"`]).toString().trim();
}

let browser;
export async function launch() {
  browser ??= await chromium.launch();
  return browser;
}
export async function closeBrowser() {
  await browser?.close();
  browser = undefined;
}

/**
 * A page signed in as the owner (or member). Every /api response is kept,
 * so a test can assert the screens' requests were accepted.
 */
export async function signedIn(email = 'owner@example.com', viewport = { width: 1280, height: 900 }) {
  const context = await (await launch()).newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  const api = [];
  const problems = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/api/')) return;
    const entry = { method: response.request().method(), path: url.replace(/^.*?\/api/, '/api'), status: response.status(), body: '' };
    if (entry.status >= 400) entry.body = await response.text().catch(() => '');
    api.push(entry);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) problems.push(`console: ${message.text().slice(0, 300)}`);
  });
  await page.addInitScript(() => sessionStorage.setItem('ll-visited-auth', '1'));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill('e2e-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('nav >> visible=true').first().waitFor();
  return { page, api, problems, context };
}

/** Opens a page through the current navigation. */
export async function openView(page, label) {
  try {
    if (['Company', 'Organization', 'Team', 'Integrations', 'Audit log'].includes(label)) {
      await page.locator('summary[aria-label="Settings"]').first().click();
      await page.getByRole('menu', { name: 'Settings' }).getByRole('menuitem', { name: label, exact: true }).click();
    } else if (label === 'Documentation') {
      await page.locator('summary[aria-label="Help"]').click();
      await page.getByRole('menu', { name: 'Help' }).getByRole('menuitem', { name: 'Documentation' }).click();
    } else {
      await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: label, exact: true }).first().click({ timeout: 5000 });
    }
  } catch (error) {
    await page.screenshot({ path: new URL(`./.work/blocked-${label.replace(/\W+/g, '-')}.png`, import.meta.url).pathname, fullPage: true });
    throw error;
  }
}

/** Select an option in a searchable form field by its accessible name. */
export async function chooseOption(scope, label, option) {
  const field = scope.getByRole('combobox', { name: label, exact: true });
  // Already chosen (a default, say): typing the same text changes nothing, so the list would not open.
  if ((await field.inputValue()) === option) return;
  await field.fill(option);
  await scope.getByRole('option', { name: option, exact: true }).click();
}

/** The writes refused since a given point, for a clear assertion message. */
export function refusedWrites(api, since = 0) {
  return api.slice(since).filter((call) => call.method !== 'GET' && call.status >= 400);
}

/** Runs a flow and saves a screenshot of the page if it fails. */
export async function flow(name, session, body) {
  try {
    await body();
  } catch (error) {
    await session.page.screenshot({ path: new URL(`./.work/failed-${name}.png`, import.meta.url).pathname, fullPage: true }).catch(() => {});
    throw error;
  }
}
