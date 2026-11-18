import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

if (!process.env.PLAYWRIGHT_MODULE_ROOT) throw new Error('Set PLAYWRIGHT_MODULE_ROOT to an existing directory with node_modules/playwright');
const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json'));
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const artifactDir = resolve(root, 'artifacts');
await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  const requestedProjects = process.argv.slice(2);
  for (const project of requestedProjects.length ? requestedProjects : ['task-lens', 'evidence-ledger']) {
    assert.ok(['task-lens', 'evidence-ledger'].includes(project));
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const errors = [], network = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    const reportFolder = project === 'task-lens' ? 'demo' : 'blocked';
    const canonical = JSON.parse(await readFile(resolve(root, project, `output/${reportFolder}/report.json`), 'utf8'));
    await page.goto(pathToFileURL(resolve(root, project, `output/${reportFolder}/report.html`)).href);
    const expectedRows = project === 'task-lens' ? 4 : canonical.claims.length;
    assert.equal(await page.locator('[data-record]').count(), expectedRows);
    assert.equal(await page.locator('#count').textContent(), `${expectedRows} / ${expectedRows}`);
    await page.locator('#filter').selectOption(project === 'task-lens' ? 'recovered' : 'blocked');
    assert.equal(await page.locator('[data-record]:visible').count(), project === 'task-lens' ? 1 : canonical.summary.blocked);
    await page.locator('#search').fill('no-such-record-zz');
    assert.equal(await page.locator('[data-record]:visible').count(), 0);
    assert.equal(await page.locator('#empty').isVisible(), true);
    await page.locator('#search').fill('');
    await page.locator('#filter').selectOption('all');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#download').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), `${canonical.tool}-report.json`);
    const downloaded = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.deepEqual(downloaded, canonical);
    if (project === 'evidence-ledger') {
      assert.equal(await page.title(), `较真 · ${canonical.dataset}`);
      assert.ok((await page.locator('#verified-text').textContent()).includes('不生成交付结论'));
    }
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${project} overflow at ${width}`);
      if (width !== 320) await page.screenshot({ path: resolve(artifactDir, `${project}-${width}.png`), fullPage: true });
    }
    await page.keyboard.press('Tab');
    assert.notEqual(await page.evaluate(() => document.activeElement.tagName), 'BODY');
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    checks.push({ project, widths: [1440, 390, 320], filter: true, searchEmptyState: true, jsonExportMatches: true, keyboard: true, externalRequests: 0, browserErrors: 0 });
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await noJs.newPage();
    await staticPage.goto(pathToFileURL(resolve(root, project, `output/${reportFolder}/report.html`)).href);
    assert.equal(await staticPage.locator('[data-record]').count(), expectedRows);
    await noJs.close();
    if (project === 'evidence-ledger') {
      const authority = JSON.parse(await readFile(resolve(root, project, 'output/authority/report.json'), 'utf8'));
      await page.goto(pathToFileURL(resolve(root, project, 'output/authority/report.html')).href);
      assert.ok((await page.locator('#verified-text').textContent()).includes('1408975000'));
      assert.ok((await page.locator('body').textContent()).includes(authority.provenance[0].rawSha256));
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `authority overflow at ${width}`);
        if (width === 1440) await page.screenshot({ path: resolve(artifactDir, 'authority-1440.png'), fullPage: true });
      }
      assert.deepEqual(errors, []); assert.deepEqual(network, []);
      checks.push({ project: 'evidence-ledger/authority', officialProvenanceVisible: true, widths: [1440, 390, 320], externalRequests: 0, browserErrors: 0 });
    }
    await context.close();
  }
  const validationFile = requestedProjects.length ? 'data-ui-validation.json' : 'ui-validation.json';
  await writeFile(resolve(artifactDir, validationFile), JSON.stringify(checks, null, 2) + '\n');
  console.log(JSON.stringify(checks, null, 2));
} finally { await browser.close(); }
