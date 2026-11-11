/**
 * Android's own backup (Auto Backup to Google Drive, restored on install), with the emulator's local
 * transport standing in for Drive, as in Google's test script (developer.android.com → Test backup
 * and restore). Checks res/xml/*backup*: what can't be rebuilt comes back, nothing else does.
 */
import { createBook, dismissLanguageReminder, expect, PKG, test } from './app';

const LOCAL = 'com.android.localtransport/.LocalTransport';

test('a reinstall restores the library, texts and settings, and nothing that is rebuilt or downloaded', async ({ app }) => {
  await createBook(app.page, '备份测试', '猫头鹰在晚上飞。');
  await app.page.getByRole('button', { name: 'Settings' }).click();
  await app.page.getByRole('button', { name: 'Larger text' }).click(); // 24px
  await app.page.getByRole('button', { name: 'Close settings' }).click();
  await app.page.locator('.book-open').first().click();
  await dismissLanguageReminder(app.page);
  await expect(app.page.locator('.page-flow')).toContainText('猫头鹰在晚上飞。');

  // Stand-ins for what must stay out: a dictionary (too big) and this install's backup folder.
  await app.asApp('mkdir -p files/dictionaries && echo {} > files/dictionaries/cc-cedict.json && echo {} > files/auto-backup.json');
  const before = await app.files();
  expect(before.some((f) => f.startsWith('derived/'))).toBe(true);

  const previous = (await app.shell('bmgr list transports')).match(/^\s*\*\s*(\S+)/m)?.[1];
  const wasEnabled = (await app.shell('bmgr enabled')).includes('enabled');
  try {
    await app.shell('bmgr enable true');
    await app.shell(`bmgr transport ${LOCAL}`);
    await app.shell("settings put secure backup_local_transport_parameters 'is_encrypted=true'");
    expect(await app.shell(`bmgr backupnow ${PKG}`)).toContain(`Package ${PKG} with result: Success`);

    // Restored by the system during the install, before the app can start.
    await app.uninstall();
    await app.install();
    await expect.poll(() => app.files(), { timeout: 30_000 }).toContain('library.json');
    const restored = await app.files();
    expect(restored).toEqual(expect.arrayContaining(['library.json', 'settings.json']));
    expect(restored.some((f) => /^books\/[^/]+\/sources\/.+\.txt$/.test(f))).toBe(true);
    expect(restored.filter((f) => /^(derived|dictionaries)\/|^auto-backup\.json$/.test(f))).toEqual([]);

    await app.launch();
    await app.page.locator('.book-open', { hasText: '备份测试' }).click();
    await dismissLanguageReminder(app.page);
    await expect(app.page.locator('.page-flow')).toContainText('猫头鹰在晚上飞。');
    await app.page.getByRole('button', { name: 'Library' }).click();
    await app.page.getByRole('button', { name: 'Settings' }).click();
    await expect(app.page.locator('.font-size-value')).toHaveText('24px');
  } finally {
    await app.shell(`bmgr wipe ${LOCAL} ${PKG}`);
    if (previous) await app.shell(`bmgr transport ${previous}`);
    await app.shell(`bmgr enable ${wasEnabled}`);
  }
});
