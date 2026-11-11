/**
 * The app on an emulator (see scripts/android-test.mjs, which starts it and sets the env below).
 * Each test gets a fresh install of the debug APK; `app.page` is its WebView, driven like the web
 * tests, and `device` drives the system UI (file and folder pickers).
 */
import { _android, expect, test as base, type AndroidDevice, type AndroidSelector, type AndroidWebView, type Page } from '@playwright/test';

export const PKG = 'com.temporis.reader';
const SERIAL = process.env.TEMPORIS_ANDROID_SERIAL;
const APK = process.env.TEMPORIS_APK;

export class App {
  page!: Page;
  private webView: AndroidWebView | null = null;

  constructor(readonly device: AndroidDevice) {}

  async shell(command: string): Promise<string> {
    // adb now and then refuses a command ("androidDevice.shell: FAIL"); they're all safe to repeat.
    return step(`shell ${command}`, async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          return (await this.device.shell(command)).toString().trim();
        } catch (err) {
          if (attempt >= 4 || !/shell: FAIL/.test(String(err))) throw new Error(`shell ${command}: ${err}`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    });
  }

  /** Runs a shell command as the app (debug builds only), from its data directory. */
  async asApp(command: string): Promise<string> {
    return this.shell(`run-as ${PKG} sh -c '${command.replace(/'/g, `'\\''`)}'`);
  }

  /** The app's files (in getFilesDir(), Capacitor's Directory.Data), sorted. */
  async files(): Promise<string[]> {
    const out = await this.asApp('cd files 2>/dev/null && find . -type f | sed "s|^./||" | sort');
    return out ? out.split(/\r?\n/) : [];
  }

  async uninstall(): Promise<void> {
    await this.shell(`pm uninstall ${PKG}`);
  }

  async install(): Promise<void> {
    if (!APK) throw new Error('TEMPORIS_APK isn’t set: run these with `npm run test:android`');
    await step('install', () => this.device.installApk(APK));
  }

  /** Starts the app and waits for the library. */
  async launch(): Promise<void> {
    await step('launch', () => this.attach());
  }

  private async attach(): Promise<void> {
    await this.shell(`am start -W -n ${PKG}/.MainActivity`);
    // Just after the emulator boots, the first WebView can be replaced while it starts: attach again.
    for (let attempt = 1; ; attempt++) {
      try {
        this.webView = await this.device.webView({ pkg: PKG });
        this.page = await this.webView.page();
        await expect(this.page.locator('body[data-ready]')).toBeAttached();
        return;
      } catch (err) {
        if (attempt >= 3 || !/has been closed/.test(String(err))) throw err;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  /** Stops the app (as if swiped away) and starts it again. */
  async restart(): Promise<void> {
    const old = this.webView;
    await step('restart', async () => {
      // The close event can go unseen; don't wait for it for ever (launch() skips a closed WebView).
      const closed = old ? new Promise<void>((resolve) => old.once('close', () => resolve())) : Promise.resolve();
      await this.shell(`am force-stop ${PKG}`);
      await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5000))]);
      await this.attach();
    });
  }

  /**
   * Taps an element of the system UI (a picker). Matching is on whole values: a RegExp must match
   * all of the text or resource id. Retried when the screen changes under the tap.
   */
  async tap(selector: AndroidSelector): Promise<void> {
    await step(`tap ${JSON.stringify(selector)}`, () => this.tapOnce(selector));
  }

  private async tapOnce(selector: AndroidSelector): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.device.tap(selector);
        return;
      } catch (err) {
        if (attempt >= 4 || !/StaleObjectException/.test(String(err))) throw err;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  async toast(text: string | RegExp): Promise<void> {
    await expect(this.page.locator('#toast.visible')).toHaveText(text);
  }
}

export const test = base.extend<{ app: App }, { device: AndroidDevice }>({
  device: [
    async ({}, use) => {
      if (!SERIAL) throw new Error('TEMPORIS_ANDROID_SERIAL isn’t set: run these with `npm run test:android`');
      const device = (await _android.devices()).find((d) => d.serial() === SERIAL);
      if (!device) throw new Error(`No device ${SERIAL}`);
      device.setDefaultTimeout(20_000);
      await use(device);
      await device.close();
    },
    { scope: 'worker' },
  ],
  app: async ({ device }, use, testInfo) => {
    const app = new App(device);
    // A picker left open by a failed test would cover the app.
    await app.shell('am force-stop com.google.android.documentsui');
    await app.uninstall();
    await app.install();
    await app.launch();
    await use(app);
    if (testInfo.status !== testInfo.expectedStatus) {
      // What was on screen (a picker?) when it failed.
      await testInfo.attach('screen.png', { body: await device.screenshot(), contentType: 'image/png' }).catch(() => undefined);
      await testInfo.attach('ui.xml', { body: await app.shell('uiautomator dump /dev/tty'), contentType: 'text/plain' }).catch(() => undefined);
    }
    await app.shell(`am force-stop ${PKG}`);
  },
});

export { expect };

/** A named step, so a hang or failure says where it happened. */
function step<T>(name: string, body: () => Promise<T>): Promise<T> {
  return base.step(name, body, { box: true });
}

/** Waits for the reader's language check and closes its "Add <language>?" reminder if one appeared. */
export async function dismissLanguageReminder(page: Page): Promise<void> {
  await expect(page.locator('.reader[data-language-check="done"]')).toBeAttached();
  const reminder = page.getByRole('dialog', { name: /^(Add .+\?|Lookups aren’t available)$/ });
  if (await reminder.count()) await reminder.getByRole('button', { name: 'Not now' }).click();
  await expect(reminder).toHaveCount(0);
}

/** Creates a book with one pasted chapter, through the app's UI (no file picker needed). */
export async function createBook(page: Page, title: string, text: string): Promise<void> {
  await page.getByRole('button', { name: 'Add book' }).click();
  await page.getByRole('menuitem', { name: 'Create a book' }).click();
  await page.getByRole('dialog', { name: 'Create a book' }).getByLabel('Title').fill(title);
  await page.getByRole('dialog', { name: 'Create a book' }).getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Add chapter' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add chapter' });
  await dialog.getByLabel('Chapter title').fill('第一章');
  await dialog.getByLabel('Chapter text').fill(text);
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Close editor' }).click();
  await expect(page.locator('.book-name', { hasText: title })).toBeVisible();
}
