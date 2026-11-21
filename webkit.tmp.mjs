import { webkit, devices } from 'playwright';
const b = await webkit.launch(); const c = await b.newContext({ ...devices['iPhone 13'], acceptDownloads: true }); const p = await c.newPage();
p.on('pageerror', e => console.log('pageerror', e.message));
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text()); });
p.on('download', d => console.log('DOWNLOAD event', d.suggestedFilename()));
p.on('framenavigated', f => { if (f === p.mainFrame()) console.log('navigated', f.url()); });
await p.goto(process.argv[2]);
await p.locator('body[data-ready="true"]').waitFor({ state: 'attached' });
await p.locator('.view:not([hidden])').getByRole('button', { name: 'Settings', exact: true }).click();
await p.locator('[data-language-link="zh"]').click();
const card = p.locator('[data-language="zh"]');
await card.getByRole('button', { name: 'Add' }).click();
for (let i = 0; i < 30; i++) { await p.waitForTimeout(1000); const t = await card.locator('.lang-status').textContent(); if (/Added|failed/.test(t)) { console.log('status:', t); break; } }
await b.close();
