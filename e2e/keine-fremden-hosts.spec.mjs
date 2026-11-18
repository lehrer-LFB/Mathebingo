import { test, expect } from '@playwright/test';
import { device } from './helpers.mjs';

// Vorgabe: Unter webapps.das-rsg.de darf kein Request an fremde Hosts gehen (keine CDNs, keine Google Fonts).
test('kein Request verlässt die eigene Origin', async ({ browser }, testInfo) => {
  const { ctx, page } = await device(browser, testInfo, { teacher: true });
  const origin = new URL(testInfo.project.use.baseURL).origin;
  const foreign = [];
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(`${origin}/`) || url.startsWith('data:')) return route.continue();
    foreign.push(url);
    return route.abort();
  });
  ctx.on('websocket', (ws) => { if (!ws.url().startsWith(origin.replace('http', 'ws'))) foreign.push(ws.url()); });

  for (const hash of ['', '#host', '#join', '#test']) {
    await page.goto(hash || './');
    await page.waitForLoadState('networkidle');
  }
  await expect(page.locator('#t-verdict')).toContainText('Netzwerk geeignet', { timeout: 15_000 });
  expect(foreign).toEqual([]);
  expect(await page.evaluate(() => typeof window.Peer)).toBe('undefined');
  await ctx.close();
});
