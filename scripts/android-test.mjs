// Runs the Android tests (tests/android) on an emulator. Slow: only for changes that touch Android.
//
//   npm run test:android                      build the debug APK, start an emulator if none is running, test
//   npm run test:android -- --if-affected     the same, but only if Android-related files changed since main
//   npm run test:android -- --no-build        reuse the last debug APK
//   npm run test:android -- -g "backup"       anything else is passed to Playwright
//
// Needs ANDROID_HOME (Android SDK with platform-tools, emulator and the system image below) and
// JAVA_HOME. The first run creates the emulator ("temporis-test"); later runs boot from its snapshot,
// or cold if the snapshot comes up wedged (booted, but every shell command hangs).
// Real phones are never used: the tests uninstall the app, which would wipe its data.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const AVD = 'temporis-test';
// On Windows the 36.1 image's SurfaceFlinger aborts every few seconds (goldfish mapper assertion
// `!hasReadColorBufferDma`, with every -gpu mode and emulator 37.2/37.3), taking the system down; 36 is stable.
const IMAGE = `system-images;android-${windows ? '36' : '36.1'};google_apis;x86_64`;
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

// Start-up watchdog: if the tests haven't started within STARTUP_MINUTES (build, emulator boot,
// cold-boot retry), the whole run is killed, emulator included, instead of hanging. It's a separate
// process because the build and adb calls block this one, so a timer here could never fire.
const STARTUP_MINUTES = Number(process.env.TEMPORIS_ANDROID_STARTUP_MINUTES) || 10;
const watchdog = spawn(
  process.execPath,
  [
    '-e',
    `setTimeout(() => {
      console.error('\\nThe Android tests didn’t start within ${STARTUP_MINUTES} minutes: stopping the run and its emulator.');
      const pid = ${process.pid};
      // First: taskkill /T takes this watchdog down with the run.
      require('fs').rmSync(${JSON.stringify(join(root, 'test-results', 'android-test.lock'))}, { force: true });
      if (process.platform === 'win32') require('child_process').spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
      else try { process.kill(pid, 'SIGTERM'); } catch {}
      process.exit(0);
    }, ${STARTUP_MINUTES * 60_000});`,
  ],
  { stdio: ['ignore', 'ignore', 'inherit'], detached: !windows },
);
watchdog.unref();
/** The tests are running (or the run is over): no more start-up deadline. */
const startedUp = () => watchdog.exitCode === null && watchdog.kill();
process.on('exit', startedUp);
// Elsewhere than Windows the watchdog sends SIGTERM; the emulator we started is detached, so stop it too.
process.on('SIGTERM', () => {
  try {
    started?.kill();
  } catch {
    // Not started yet.
  }
  process.exit(1);
});

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
/** Every call has a timeout: a wedged emulator otherwise hangs adb (and this script) for good. */
const adb = (...a) => execFileSync(adbPath, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }).trim();
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

// One run at a time: two would fight over the emulator (and a stuck one used to block the next).
const LOCK = join(root, 'test-results', 'android-test.lock');
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
if (existsSync(LOCK)) {
  const pid = Number(readFileSync(LOCK, 'utf8'));
  if (pid && pid !== process.pid && alive(pid)) {
    console.error(`Another Android test run (pid ${pid}) is still going. Stop it first.`);
    process.exit(1);
  }
}
mkdirSync(dirname(LOCK), { recursive: true });
writeFileSync(LOCK, String(process.pid));
process.on('exit', () => rmSync(LOCK, { force: true }));

if (!noBuild) run('npm', ['run', 'apk']);
if (!existsSync(APK)) {
  console.error(`No debug APK at ${APK}`);
  process.exit(1);
}

let started = null;
let serial = emulators()[0];

/** Usable, not just booted: a snapshot can come up with boot_completed set and every command hanging. */
const ready = () => {
  try {
    if (adb('-s', serial, 'shell', 'getprop sys.boot_completed') !== '1') return false;
    adb('-s', serial, 'shell', 'settings get global window_animation_scale'); // throws if it hangs
    return adb('-s', serial, 'shell', 'pm path android').startsWith('package:');
  } catch {
    return false; // Still starting, "offline" for a moment, or wedged (timed out).
  }
};

async function waitUntilReady(seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (ready()) return true;
    await sleep(2000);
  }
  return false;
}

async function startEmulator(cold) {
  const avds = execFileSync(tool('emulator', 'emulator'), ['-list-avds'], { encoding: 'utf8' }).split(/\r?\n/);
  if (!avds.includes(AVD)) {
    if (!existsSync(join(sdk, ...IMAGE.split(';')))) {
      console.error(`Missing system image. Install it with:\n  sdkmanager "emulator" "${IMAGE}"`);
      process.exit(1);
    }
    console.log(`Creating the ${AVD} emulator…`);
    run(tool('cmdline-tools', 'latest', 'bin', 'avdmanager'), ['create', 'avd', '-n', AVD, '-k', IMAGE, '-d', 'pixel_7'], { input: 'no\n', stdio: ['pipe', 'inherit', 'inherit'] });
  }
  console.log(`Starting the ${AVD} emulator${cold ? ' (cold boot)' : ''}…`);
  // Software graphics without Vulkan: headless runs don't need it, and it crashed the emulator.
  const options = ['-avd', AVD, '-no-window', '-no-audio', '-no-boot-anim', '-gpu', 'swiftshader_indirect', '-feature', '-Vulkan', ...(cold ? ['-no-snapshot-load'] : [])];
  started = spawn(tool('emulator', 'emulator'), options, { stdio: 'ignore', detached: !windows });
  serial = undefined;
  for (let i = 0; i < 180 && !serial; i++) {
    await sleep(1000);
    serial = emulators()[0];
  }
  if (!serial) {
    console.error('The emulator didn’t start.');
    process.exit(1);
  }
}

/** Stops the emulator we started. `save`: keep the snapshot (not when it's the wedged one). */
async function stopEmulator(save) {
  if (!started) return;
  try {
    if (save) adb('-s', serial, 'emu', 'kill');
    else started.kill();
  } catch {
    started.kill();
  }
  for (let i = 0; i < 60; i++) {
    try {
      if (!adb('devices').includes(serial)) break;
    } catch {
      break;
    }
    await sleep(1000);
  }
  started = null;
}

if (!serial) await startEmulator(false);
if (!(await waitUntilReady(180))) {
  if (!started) {
    console.error(`${serial} is running but doesn't respond. Close it and run again.`);
    process.exit(1);
  }
  console.log('The emulator came up unresponsive; starting it again from a cold boot.');
  await stopEmulator(false);
  await startEmulator(true);
  if (!(await waitUntilReady(300))) {
    console.error('The emulator didn’t finish booting.');
    await stopEmulator(false);
    process.exit(1);
  }
}
const shell = (cmd) => adb('-s', serial, 'shell', cmd);
// Animations only slow the tests down and make native UI waits flaky.
for (const s of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) shell(`settings put global ${s} 0`);

// Playwright's helper for driving the system UI (once per machine; quick when already installed).
run('npx', ['playwright', 'install', 'android']);

startedUp();
console.log(`Testing on ${serial}`);
const result = spawnSync('npx', ['playwright', 'test', '-c', 'playwright.android.config.js', ...args], {
  stdio: 'inherit',
  cwd: root,
  shell: windows,
  env: { ...process.env, TEMPORIS_ANDROID_SERIAL: serial, TEMPORIS_APK: APK },
});

// Saves the snapshot, so the next run boots in seconds; waits until it's gone, so a run straight
// after this one doesn't find it half shut down.
await stopEmulator(true);
process.exit(result.status ?? 1);
