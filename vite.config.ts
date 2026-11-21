import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * `WEB_APP=1` (npm run build:web) builds the installable web version into dist-web/: relative
 * paths (it's served from a subfolder on GitHub Pages) and a service worker so it opens offline.
 * Without it, the build is the one Capacitor bundles into the APK and the web tests run against.
 */
const webApp = process.env.WEB_APP === '1';

/** Emits sw.js (web/sw.js) with every file of the build to keep for offline use. */
function serviceWorker(): Plugin {
  const publicDir = 'public';
  const publicFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? publicFiles(join(dir, e.name)) : [relative(publicDir, join(dir, e.name)).replaceAll('\\', '/')]));
  return {
    name: 'temporis-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = ['./', ...Object.keys(bundle).filter((f) => !f.endsWith('.map')), ...publicFiles(publicDir)];
      const source = readFileSync('web/sw.js', 'utf8')
        .replace('__CACHE__', JSON.stringify(`temporis-${version}-${Date.now()}`))
        .replace('__FILES__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version), __WEB_APP__: JSON.stringify(webApp) },
  base: webApp ? './' : '/',
  build: { target: 'es2022', ...(webApp ? { outDir: 'dist-web' } : {}) },
  plugins: webApp ? [serviceWorker()] : [],
});
