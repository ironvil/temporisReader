/**
 * Automatic backups: the same file as Settings → Back up library, written to a folder the user
 * chose (on the phone, an SD card, or a cloud folder such as Google Drive), keeping the last
 * KEEP_BACKUPS. Complements Android's own backup, which keeps only one copy, needs a Google
 * account, and can't be opened or copied by the user.
 *
 * There's no background job: a backup is made when the app starts or comes back to the
 * foreground, if one is due and something changed since the last. Nothing changes while the app
 * isn't used, so nothing is missed.
 *
 * The folder and its state are kept in auto-backup.json, which neither kind of backup includes:
 * access to a folder belongs to one install, so a restored install asks for it again.
 *
 * Android: the folder is a Storage Access Framework tree with a persisted read/write grant
 * (android/…/BackupFolderPlugin.java). Web (dev server, e2e tests): a stand-in folder in the app's
 * storage, like the linked files' stand-in "device storage".
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { createBackup } from './backup';
import { sha256, WEB_DEVICE_DIR, WEB_SCHEME } from './books/linked-files';
import { listFiles, readJson, removeFile, writeJson, writeText } from './storage';

export const KEEP_BACKUPS = 5;
export const AUTO_BACKUP_PREFIX = 'temporis-auto-backup-';
const FILE = 'auto-backup.json';
const DAY = 24 * 60 * 60 * 1000;
export const FREQUENCIES = { daily: DAY, weekly: 7 * DAY } as const;
export type Frequency = keyof typeof FREQUENCIES;

export interface BackupFolder {
  uri: string;
  /** Shown in settings. */
  name: string;
}

export type FolderProblem = 'denied' | 'missing' | 'failed';

export interface AutoBackupState {
  folder: BackupFolder | null;
  frequency: Frequency;
  /** The last backup written. `hash` is of its contents without the date, to skip unchanged ones. */
  last: { at: string; file: string; hash: string } | null;
  /** When a due backup was last skipped because nothing had changed. */
  checkedAt: string | null;
  /** The last attempt's failure, until one succeeds. */
  error: { at: string; problem: FolderProblem; message: string } | null;
}

const DEFAULT_STATE: AutoBackupState = { folder: null, frequency: 'weekly', last: null, checkedAt: null, error: null };

export class FolderError extends Error {
  constructor(
    readonly problem: FolderProblem,
    message: string,
  ) {
    super(message);
  }
}

interface BackupFolderPlugin {
  pick(): Promise<{ cancelled: true } | { cancelled: false; uri: string; name: string }>;
  write(options: { folder: string; name: string; data: string }): Promise<{ name: string }>;
  list(options: { folder: string }): Promise<{ files: { name: string; size: number; modified: number }[] }>;
  remove(options: { folder: string; name: string }): Promise<void>;
  release(options: { folder: string }): Promise<void>;
}

const plugin = registerPlugin<BackupFolderPlugin>('BackupFolder');

/** Web stand-in for a picked folder. */
export const WEB_BACKUP_FOLDER: BackupFolder = { uri: `${WEB_SCHEME}${WEB_DEVICE_DIR}/Backups`, name: 'Backups (browser storage)' };

/** Native rejections carry a code; anything else is a plain failure. */
function asFolderError(err: unknown): FolderError {
  if (err instanceof FolderError) return err;
  const code = (err as { code?: string })?.code;
  const message = err instanceof Error ? err.message : String(err);
  return new FolderError(code === 'denied' || code === 'missing' ? code : 'failed', message);
}

/** Calls the folder's backend: the native plugin, or the web stand-in in app storage. */
const folderApi = {
  async write(folder: BackupFolder, name: string, data: string): Promise<string> {
    if (folder.uri.startsWith(WEB_SCHEME)) {
      await writeText(`${folder.uri.slice(WEB_SCHEME.length)}/${name}`, data);
      return name;
    }
    if (!Capacitor.isNativePlatform()) throw new FolderError('missing', 'The backup folder was moved or deleted');
    return (await plugin.write({ folder: folder.uri, name, data }).catch((e) => Promise.reject(asFolderError(e)))).name;
  },
  async list(folder: BackupFolder): Promise<string[]> {
    if (folder.uri.startsWith(WEB_SCHEME)) return (await listFiles(folder.uri.slice(WEB_SCHEME.length))).map((f) => f.name);
    if (!Capacitor.isNativePlatform()) throw new FolderError('missing', 'The backup folder was moved or deleted');
    return (await plugin.list({ folder: folder.uri }).catch((e) => Promise.reject(asFolderError(e)))).files.map((f) => f.name);
  },
  async remove(folder: BackupFolder, name: string): Promise<void> {
    if (folder.uri.startsWith(WEB_SCHEME)) return removeFile(`${folder.uri.slice(WEB_SCHEME.length)}/${name}`);
    await plugin.remove({ folder: folder.uri, name }).catch((e) => Promise.reject(asFolderError(e)));
  },
  async release(folder: BackupFolder): Promise<void> {
    if (!folder.uri.startsWith(WEB_SCHEME) && Capacitor.isNativePlatform()) await plugin.release({ folder: folder.uri }).catch(() => undefined);
  },
};

export async function autoBackupState(): Promise<AutoBackupState> {
  return { ...DEFAULT_STATE, ...((await readJson<Partial<AutoBackupState>>(FILE)) ?? {}) };
}

async function updateState(patch: Partial<AutoBackupState>): Promise<AutoBackupState> {
  const state = { ...(await autoBackupState()), ...patch };
  await writeJson(FILE, state);
  return state;
}

/** Asks for a folder (the system folder picker; the stand-in on the web). Null if cancelled. */
export async function chooseBackupFolder(): Promise<BackupFolder | null> {
  let folder: BackupFolder;
  if (Capacitor.isNativePlatform()) {
    const picked = await plugin.pick().catch((e) => Promise.reject(asFolderError(e)));
    if (picked.cancelled) return null;
    folder = { uri: picked.uri, name: picked.name };
  } else {
    folder = WEB_BACKUP_FOLDER;
  }
  const previous = (await autoBackupState()).folder;
  if (previous && previous.uri !== folder.uri) await folderApi.release(previous);
  // A new folder gets a backup straight away, whatever was written to the old one.
  await updateState({ folder, last: null, checkedAt: null, error: null });
  return folder;
}

/** Stops automatic backups and gives up access to the folder (its backups are left there). */
export async function turnOffAutoBackup(): Promise<void> {
  const { folder } = await autoBackupState();
  if (folder) await folderApi.release(folder);
  await updateState({ folder: null, last: null, checkedAt: null, error: null });
}

export async function setBackupFrequency(frequency: Frequency): Promise<void> {
  await updateState({ frequency });
}

/** e.g. temporis-auto-backup-2026-11-11-1430.json (local time, so names sort by age). */
export function backupFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${AUTO_BACKUP_PREFIX}${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}

export type AutoBackupResult =
  | { status: 'off' | 'not-due' | 'unchanged' }
  | { status: 'written'; file: string }
  | { status: 'failed'; error: FolderError; firstFailure: boolean };

let running: Promise<AutoBackupResult> | null = null;

/**
 * Writes a backup if one is due (or `now`, from "Back up now") and the library changed since the
 * last, then removes automatic backups beyond the newest KEEP_BACKUPS. Other files in the folder,
 * such as backups saved by hand, are never touched.
 */
export function runAutoBackup(options: { now?: boolean } = {}): Promise<AutoBackupResult> {
  running ??= attempt(!!options.now).finally(() => (running = null));
  return running;
}

async function attempt(now: boolean): Promise<AutoBackupResult> {
  const state = await autoBackupState();
  const { folder } = state;
  if (!folder) return { status: 'off' };
  const since = Math.max(Date.parse(state.last?.at ?? '') || 0, Date.parse(state.checkedAt ?? '') || 0);
  // A failed attempt is retried on the next start or return to the app, not a day later.
  if (!now && !state.error && Date.now() - since < FREQUENCIES[state.frequency]) return { status: 'not-due' };

  try {
    const backup = await createBackup();
    const hash = await sha256(new TextEncoder().encode(JSON.stringify({ ...backup, createdAt: '' })));
    if (!now && state.last?.hash === hash) {
      await updateState({ checkedAt: new Date().toISOString(), error: null });
      return { status: 'unchanged' };
    }
    const file = await folderApi.write(folder, backupFileName(new Date(backup.createdAt)), JSON.stringify(backup));
    await updateState({ last: { at: backup.createdAt, file, hash }, checkedAt: null, error: null });
    await prune(folder, file);
    return { status: 'written', file };
  } catch (err) {
    const error = asFolderError(err);
    await updateState({ error: { at: new Date().toISOString(), problem: error.problem, message: error.message } });
    return { status: 'failed', error, firstFailure: !state.error };
  }
}

/** Keeps the newest KEEP_BACKUPS automatic backups (the one just written always among them). */
async function prune(folder: BackupFolder, written: string): Promise<void> {
  try {
    const ours = (await folderApi.list(folder)).filter((n) => n.startsWith(AUTO_BACKUP_PREFIX) && n.endsWith('.json') && n !== written).sort();
    for (const name of ours.slice(0, Math.max(0, ours.length - (KEEP_BACKUPS - 1)))) await folderApi.remove(folder, name);
  } catch (err) {
    // The backup itself was written; old ones are removed next time.
    console.warn('Removing old backups failed', err);
  }
}
