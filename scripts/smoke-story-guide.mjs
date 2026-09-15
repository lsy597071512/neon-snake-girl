/**
 * 浏览器冒烟：清档 → 标题进主城 → 看板跟随弹出 → 营地锁定
 */
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let failed = 0;
function ok(msg) {
  console.log('OK:', msg);
}
function fail(msg) {
  console.error('FAIL:', msg);
  failed++;
}

const server = await createServer({
  root,
  server: { host: '127.0.0.1', port: 0, strictPort: false },
  logLevel: 'error',
});
await server.listen();
const addr = server.httpServer?.address();
const port = typeof addr === 'object' && addr ? addr.port : 5199;
const baseUrl = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => {
    localStorage.clear();
    const licensePayload = btoa(
      JSON.stringify({
        c: 'RB-TEST-STORY',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    localStorage.setItem('rb-license-token', `${licensePayload}.test-signature`);
    localStorage.setItem('rb-license-validated-at', String(Date.now()));
    // 跳过世界观 PV，直接测跟随 + 引导锁
    localStorage.setItem(
      'rust-belt-era-save-v1',
      JSON.stringify({
        version: 8,
        gold: 800,
        tickets: 3,
        gachaPity: 0,
        armoryLevel: 1,
        armoryUpgradeEnd: null,
        ownedCharacters: [
          { characterId: 'ashcrow', weaponId: 'w01', giftCount: 0, shardPowerBonus: 0 },
          { characterId: 'heartforge', weaponId: null, giftCount: 0, shardPowerBonus: 0 },
        ],
        ownedWeaponIds: ['w01'],
        squad: [],
        clearedStages: [],
        achievementsClaimed: [],
        tasksClaimed: [],
        characterShards: {},
        weaponShards: {},
        characterShardUses: {},
        weaponShardUses: {},
        weaponEnhanceBonus: {},
        stats: {
          stagesCleared: 0,
          totalKills: 0,
          charactersOwned: 2,
          giftsSent: 0,
          legendariesEquipped: 0,
          highestStage: 0,
          playTimeSeconds: 0,
        },
        sweepCharges: 15,
        sweepRecoverAnchorAt: Date.now(),
        tutorialFlags: {
          combatDone: false,
          armoryVideoSeen: false,
          worldIntroSeen: true,
          storyHubFollowSeen: false,
          storyGuideStep: 'g_hello',
          storyGuideDone: false,
          storyGuideArmoryOpened: false,
          storyBeatsSeen: [],
          storyChoiceLog: {},
        },
        settings: {
          useLivePortrait: false,
          hubFeaturedCharId: null,
          hubMidUiVisible: true,
          debugInfiniteGold: false,
          disciplineEnabled: true,
        },
      }),
    );
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });

  await page.waitForSelector('[data-title-start]', { timeout: 30000 });
  await page.click('[data-title-start]');

  await page.waitForSelector('.story-overlay', { timeout: 60000 });
  ok('hub follow overlay shown');

  for (let i = 0; i < 80; i++) {
    if ((await page.locator('.story-overlay').count()) === 0) break;
    const choice = page.locator('.story-choices:not(.is-hidden) .story-choice-btn').first();
    if ((await choice.count()) > 0) {
      await choice.click({ timeout: 5000 });
      await page.waitForTimeout(150);
      continue;
    }
    const confirm = page.locator('.story-confirm-row:not(.is-hidden) .story-confirm-btn').first();
    if ((await confirm.count()) > 0) {
      await confirm.click({ timeout: 5000 });
      await page.waitForTimeout(150);
      continue;
    }
    // 双击：先吃完打字机，再续页
    await page.locator('.story-box').click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(40);
    await page.locator('.story-box').click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(80);
  }

  await page.waitForSelector('.wl-hub', { timeout: 30000 });
  await page.waitForSelector('[data-story-guide-dock]', { timeout: 20000 });
  ok('shopkeeper guide dock visible');

  if ((await page.locator('[data-story-locked="camp"]').count()) > 0) ok('camp nav locked');
  else fail('camp not locked');

  if ((await page.locator('[data-hub-commander], .hub-commander-portrait').count()) > 0) {
    ok('commander on empty hub');
  } else {
    fail('commander portrait missing');
  }

  await page.click('[data-goto="camp"]');
  await page.waitForTimeout(500);
  const alertVisible = (await page.locator('.confirm-overlay, .confirm-modal').count()) > 0;
  const stillNotCamp = (await page.locator('.camp-hub-back, [data-camp-floor]').count()) === 0;
  if (alertVisible || stillNotCamp) ok('camp click blocked while locked');
  else fail('entered camp while locked');

  // 关掉营地锁提示
  const alertOk = page.locator('.confirm-overlay [data-confirm-ok]');
  if ((await alertOk.count()) > 0) {
    await alertOk.click();
    await page.waitForTimeout(200);
  }

  // 推进老板娘确认两步，编队应高亮
  await page.locator('[data-story-guide-confirm]').click({ timeout: 10000 });
  await page.waitForTimeout(300);
  await page.locator('[data-story-guide-confirm]').click({ timeout: 10000 });
  await page.waitForTimeout(300);
  if ((await page.locator('.story-guide-highlight').count()) > 0) ok('squad highlight after identity');
  else fail('no guide highlight on squad step');

  if (errors.length) {
    fail(`page errors: ${errors.slice(0, 3).join(' | ')}`);
  } else {
    ok('no page errors');
  }
} finally {
  await browser.close();
  await server.close();
}

if (failed) {
  console.error(`\n${failed} smoke checks failed`);
  process.exit(1);
}
console.log('\nStory guide smoke passed');
