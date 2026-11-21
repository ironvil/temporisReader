/**
 * The installable web version (npm run build:web, published to GitHub Pages): for iPhones and
 * iPads, added to the home screen from Safari, without the App Store. The APK and the test build
 * have WEB_APP false, so none of this runs there.
 *
 * What differs from the APK:
 * - Dictionary sites don't allow downloads from web pages (no CORS headers), so the dictionaries
 *   that can be are copied next to the app when it's published (scripts/build-web.mjs)
 *   and downloaded from there; the others aren't offered.
 * - There's no folder to back up to automatically; library backups are saved by hand.
 * - Everything lives in the browser's storage, so it asks the browser to keep it.
 */
// Undefined outside Vite (the unit tests run the sources in Node).
export const WEB_APP = typeof __WEB_APP__ !== 'undefined' && __WEB_APP__;

/** Dictionary files published with the web version (scripts/build-web.mjs). */
export const MIRRORED_DICTIONARIES = ['cc-cedict.txt.gz', 'jmdict.gz'] as const;

/** In the web version, where a dictionary is downloaded from instead of `url`. */
export function dictionaryUrl(url: string, mirrored: (typeof MIRRORED_DICTIONARIES)[number]): string {
  return WEB_APP ? new URL(`dictionaries/${mirrored}`, document.baseURI).href : url;
}

/** Why a dictionary can't be added in the web version. */
export const NOT_IN_WEB_APP = 'Not available in the web version yet: its website doesn’t allow downloads from web pages.';

/**
 * Registers the service worker and asks to keep the library. Web version only. `save` runs before
 * a new version reloads the app (it saves the reading position).
 */
export function startWebApp(save: () => Promise<void>): void {
  if (!WEB_APP) return;
  // Without this, Safari may clear the library after weeks unused (less so once on the home screen).
  void navigator.storage?.persist?.().catch(() => undefined);

  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker
    .register('./sw.js')
    .then((registration) => {
      // A new version waits until the app is in the background, then takes over and reloads, so
      // it never swaps in mid-page.
      const update = async () => {
        if (!registration.waiting || !navigator.serviceWorker.controller) return;
        await save().catch(() => undefined);
        registration.waiting?.postMessage('skip-waiting');
      };
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) void update();
        else void registration.update().catch(() => undefined);
      });
    })
    .catch((err) => console.error('Service worker not registered', err));

  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first install takes control without a new version to load.
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}
