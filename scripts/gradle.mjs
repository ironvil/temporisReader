// Runs the Android Gradle wrapper on any OS (npm runs scripts with cmd.exe on Windows, where `./gradlew` fails):
//   node scripts/gradle.mjs assembleRelease
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const android = join(dirname(fileURLToPath(import.meta.url)), '..', 'android');
const windows = process.platform === 'win32';
// The full path: cmd.exe doesn't look in the current folder when NoDefaultCurrentDirectoryInExePath is set.
const result = spawnSync(windows ? `"${join(android, 'gradlew.bat')}"` : './gradlew', process.argv.slice(2), {
  cwd: android,
  stdio: 'inherit',
  shell: windows, // .bat files can only be started through a shell
});
process.exit(result.status ?? 1);
