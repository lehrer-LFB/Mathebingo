import { test, expect } from '@playwright/test';
import { device, solve } from './helpers.mjs';

test('Ablauf: Raum eröffnen, zwei Beitritte, Kugel, Wiederverbinden, Bingo', async ({ browser }, testInfo) => {
  const host = await device(browser, testInfo, { teacher: true });
  await host.page.goto('#host');
  await expect(host.page.locator('#h-status')).toHaveText('Raum offen');
  await expect(host.page.locator('#portal-link')).toBeVisible();
  await expect(host.page.locator('#test-banner')).toBeVisible();
  const code = (await host.page.locator('#h-code').textContent()).trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);

  // Kleine Karte für einen kurzen Test: Plus bis 20 (3×3, Zahlen 2–20)
  await host.page.locator('label', { hasText: 'Plus-Aufgaben' }).click();
  await host.page.locator('label', { hasText: 'bis 20' }).click();
  await expect(host.page.locator('#h-rules-info')).toContainText('Karte 3×3');

  const players = [];
  for (const nick of ['Rechenfuchs', 'Rechenfuchs']) {
    const p = await device(browser, testInfo);
    await p.page.goto(`#join?room=${code}`);
    await expect(p.page.locator('.privacy')).toHaveText('Kein echter Name nötig, ein Spitzname reicht.');
    await p.page.fill('#p-nickname', nick);
    await p.page.click('#p-joinbtn');
    await expect(p.page.locator('#p-card')).toBeVisible();
    await p.page.click('#p-fill');
    await p.page.click('#p-ready');
    await expect(p.page.locator('#p-game')).toBeVisible();
    players.push(p);
  }
  // Doppelter Spitzname bekommt eine Ziffer
  await expect(players[1].page.locator('#p-who')).toContainText('Rechenfuchs 2');
  await expect(host.page.locator('#h-pcount')).toHaveText('2/2');

  await host.page.click('#h-start');
  await expect(host.page.locator('#h-ballnr')).toContainText('Kugel 1 von 19');
  await expect(players[0].page.locator('#p-ballnr')).toContainText('Kugel 1');

  // Spieler:in 2 trennt sich (Neuladen wie nach Display-Sperre) und kommt mit Token und Karte zurück
  const before = await players[1].page.locator('#p-grid .cell').allTextContents();
  await players[1].page.reload();
  await expect(players[1].page.locator('#p-game')).toBeVisible();
  await expect(players[1].page.locator('#p-status')).toHaveText('verbunden');
  expect(await players[1].page.locator('#p-grid .cell').allTextContents()).toEqual(before);
  await expect(host.page.locator('#h-pcount2')).toHaveText('2/2');
  await expect(host.page.locator('#h-players-game li.offline')).toHaveCount(0);

  // Kugeln ziehen, Spieler:in 1 markiert Treffer, bis BINGO möglich ist
  const p1 = players[0].page;
  for (let nr = 1; nr <= 19; nr++) {
    if (nr > 1) {
      await host.page.click('#h-next');
      await expect(p1.locator('#p-ballnr')).toContainText(`Kugel ${nr}`);
    }
    const result = solve(await p1.locator('#p-task').textContent());
    const cell = p1.locator('#p-grid button.cell', { hasText: new RegExp(`^${result}$`) });
    if (await cell.count()) await cell.click();
    if (await p1.locator('#p-bingo').isEnabled()) break;
  }
  await expect(p1.locator('#p-bingo')).toBeEnabled();
  await p1.click('#p-bingo');
  await expect(p1.locator('.toast.good')).toContainText('BINGO');
  await expect(host.page.locator('#h-claims li.ok')).toContainText('Rechenfuchs');
  await expect(players[1].page.locator('.toast')).toContainText('Rechenfuchs hat BINGO');

  // Lehrkraft lädt neu: Raum und Spielstand bleiben, alle sind wieder verbunden
  await host.page.reload();
  await expect(host.page.locator('#h-status')).toHaveText('Raum offen');
  await expect(host.page.locator('#h-code-small')).toHaveText(code);
  await expect(host.page.locator('#h-players-game li.offline')).toHaveCount(0);

  // Runde beenden → Lösungen bei allen
  await host.page.click('#h-pause'); // weiter pausiert nach Neuladen
  await host.page.click('#h-endbtn');
  await expect(p1.locator('#p-end')).toBeVisible();
  await expect(p1.locator('#p-solutions li').first()).toBeVisible();

  for (const c of [host, ...players]) await c.ctx.close();
});

test('Raum sperren und Spieler:in entfernen', async ({ browser }, testInfo) => {
  const host = await device(browser, testInfo, { teacher: true });
  await host.page.goto('#host');
  await expect(host.page.locator('#h-status')).toHaveText('Raum offen');
  const code = (await host.page.locator('#h-code').textContent()).trim();

  const a = await device(browser, testInfo);
  await a.page.goto(`#join?room=${code}`);
  await a.page.fill('#p-nickname', 'Zahlenheld');
  await a.page.click('#p-joinbtn');
  await expect(a.page.locator('#p-card')).toBeVisible();

  await host.page.locator('#h-joinbox .h-lock').check();
  const b = await device(browser, testInfo);
  await b.page.goto(`#join?room=${code}`);
  await b.page.fill('#p-nickname', 'Zuspät');
  await b.page.click('#p-joinbtn');
  await expect(b.page.locator('#p-joinmsg')).toContainText('gesperrt');

  await host.page.getByRole('button', { name: 'Zahlenheld entfernen' }).first().click();
  await expect(a.page.locator('#p-joinmsg')).toContainText('entfernt');
  await expect(host.page.locator('#h-pcount')).toHaveText('0/0');
  for (const c of [host, a, b]) await c.ctx.close();
});

test('ohne Lehrkraft-Login kein Raum, Mitspielen ohne Login möglich', async ({ browser }, testInfo) => {
  const pupil = await device(browser, testInfo);
  await pupil.page.goto('#host');
  await expect(pupil.page.locator('#view-login')).toBeVisible();
  await expect(pupil.page.locator('#view-login a[href="/login"]')).toBeVisible();
  await expect(pupil.page.locator('#view-host')).toBeHidden();
  await pupil.page.goto('#join');
  await expect(pupil.page.locator('#p-join')).toBeVisible();
  await pupil.ctx.close();
});

test('Touch-Ziele mindestens 44 pt', async ({ browser }, testInfo) => {
  const host = await device(browser, testInfo, { teacher: true });
  await host.page.goto('#host');
  await expect(host.page.locator('#h-status')).toHaveText('Raum offen');
  const p = await device(browser, testInfo);
  await p.page.goto('#join');
  await expect(p.page.locator('#p-join')).toBeVisible();
  for (const page of [host.page, p.page]) {
    const small = await page.$$eval('button, a.btn, .seg span, label.check, label.toggle, input[type=checkbox], input[type=range], .rsg-portal-link a', (els) => els
      .filter((e) => e.offsetParent !== null)
      .map((e) => {
        const target = e.matches('input[type=checkbox]') ? e.closest('label') || e : e;
        const r = target.getBoundingClientRect();
        return { what: target.textContent.trim().slice(0, 30) || target.outerHTML.slice(0, 40), h: Math.round(r.height) };
      })
      .filter((x) => x.h < 44));
    expect(small).toEqual([]);
  }
  await host.ctx.close();
  await p.ctx.close();
});
