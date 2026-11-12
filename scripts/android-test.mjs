// Runs the Android tests (tests/android) on an emulator. Slow: only for changes that touch Android.
//
//   npm run test:android                      build the debug APK, start an emulator if none is running, test
//   npm run test:android -- --if-affected     the same, but only if Android-related files changed since main
//   npm run test:android -- --no-build        reuse the last debug APK
//   npm run test:android -- -g "backup"       anything else is passed to Playwright
//
// Needs ANDROID_HOME (Android SDK with platform-tools, emulator and the system image below) and
// JAVA_HOME. The first run creates the emulator ("temporis-test"); later runs boot from its snapshot.
// Real phones are never used: the tests uninstall the app, which would wipe its data.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const AVD = 'temporis-test';
const IMAGE = 'system-images;android-36.1;google_apis;x86_64';
const APK = join(root, 'android/app/build/outputs/apk/debug/app-debug.apk');

/** Paths whose changes can break what the Android tests cover. Keep in step with CLAUDE.md. */
const AFFECTS = [
  /^android\//,
  /^capacitor\.config\.json$/,
  /^tests\/android\//,
  /^playwright\.android\.config\.js$/,
  /^scripts\/android-test\.mjs$/,
  // Code that calls the native plugins or decides what's on disk (and so what Android backs up).
  /^src\/books\/linked-files\.ts$/,
  /^src\/auto-backup\.ts$/,
  /^src\/backup\.ts$/,
  /^src\/storage\.ts$/,
  /^src\/export\.ts$/,
];

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const ifAffected = flag('--if-affected');
const noBuild = flag('--no-build');

const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

if (ifAffected) {
  const since = git('merge-base', 'main', 'HEAD');
  const changed = [...git('diff', '--name-only', since).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean);
  // package.json changes on every release; only Capacitor dependency changes count.
  const capacitorBump = /^[+-].*"@capacitor\//m.test(git('diff', since, '--', 'package.json'));
  const hits = changed.filter((f) => AFFECTS.some((re) => re.test(f)));
  if (!hits.length && !capacitorBump) {
    console.log('No Android-related changes since main: Android tests skipped.');
    process.exit(0);
  }
  console.log(`Android-related changes:\n  ${[...hits, ...(capacitorBump ? ['package.json (Capacitor)'] : [])].join('\n  ')}`);
}

const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!sdk) {
  console.error('Set ANDROID_HOME to the Android SDK (see README → Toolchain).');
  process.exit(1);
}
const tool = (...parts) => join(sdk, ...parts) + (windows ? (parts[0] === 'cmdline-tools' ? '.bat' : '.exe') : '');
const adbPath = tool('platform-tools', 'adb');
const adb = (...a) => execFileSync(adbPath, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const run = (cmd, a, options = {}) => {
  const result = spawnSync(cmd, a, { stdio: 'inherit', cwd: root, shell: windows, ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const emulators = () =>
  adb('devices')
    .split('\n')
    .slice(1)
    .map((l) => l.split('\t'))
    .filter(([serial, state]) => serial.startsWith('emulator-') && state === 'device')
    .map(([serial]) => serial);

if (!noBuild) run('npm', ['run', 'apk']);
if (!existsSync(APK)) {
  console.error(`No debug APK at ${APK}`);
  process.exit(1);
}

let started = null;
let serial = emulators()[0];
if (!serial) {
  const avds = execFileSync(tool('emulator', 'emulator'), ['-list-avds'], { encoding: 'utf8' }).split(/\r?\n/);
  if (!avds.includes(AVD)) {
    if (!existsSync(join(sdk, ...IMAGE.split(';')))) {
      console.error(`Missing system image. Install it with:\n  sdkmanager "emulator" "${IMAGE}"`);
      process.exit(1);
    }
    console.log(`Creating the ${AVD} emulator…`);
    run(tool('cmdline-tools', 'latest', 'bin', 'avdmanager'), ['create', 'avd', '-n', AVD, '-k', IMAGE, '-d', 'pixel_7'], { input: 'no\n', stdio: ['pipe', 'inherit', 'inherit'] });
  }
  console.log(`Starting the ${AVD} emulator…`);
  // Software graphics without Vulkan: headless runs don't need it, and it crashed the emulator.
  started = spawn(tool('emulator', 'emulator'), ['-avd', AVD, '-no-window', '-no-audio', '-no-boot-anim', '-gpu', 'swiftshader_indirect', '-feature', '-Vulkan'], { stdio: 'ignore', detached: !windows });
  for (let i = 0; i < 180 && !serial; i++) {
    await sleep(1000);
    serial = emulators()[0];
  }
  if (!serial) {
    console.error('The emulator didn’t start.');
    process.exit(1);
  }
}

const shell = (cmd) => adb('-s', serial, 'shell', cmd);
const booted = () => {
  try {
    return shell('getprop sys.boot_completed') === '1';
  } catch {
    return false; // Still starting (or "offline" for a moment).
  }
};
for (let i = 0; !booted(); i++) {
  if (i > 180) {
    console.error('The emulator didn’t finish booting.');
    process.exit(1);
  }
  await sleep(1000);
}
// Animations only slow the tests down and make native UI waits flaky.
for (const s of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) shell(`settings put global ${s} 0`);

// Playwright's helper for driving the system UI (once per machine; quick when already installed).
run('npx', ['playwright', 'install', 'android']);

console.log(`Testing on ${serial}`);
const result = spawnSync('npx', ['playwright', 'test', '-c', 'playwright.android.config.js', ...args], {
  stdio: 'inherit',
  cwd: root,
  shell: windows,
  env: { ...process.env, TEMPORIS_ANDROID_SERIAL: serial, TEMPORIS_APK: APK },
});

if (started) {
  // Saves the snapshot, so the next run boots in seconds. Waits until it's gone, so a run straight
  // after this one doesn't find it half shut down.
  try {
    adb('-s', serial, 'emu', 'kill');
  } catch {
    started.kill();
  }
  for (let i = 0; i < 60 && adb('devices').includes(serial); i++) await sleep(1000);
}
process.exit(result.status ?? 1);
