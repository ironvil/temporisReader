/**
 * Files that are read where they are instead of being copied into the app (EPUBs). The library
 * stores only a reference (uri, name, size, checksum) and reads the file again each time it opens.
 *
 * Android: a content:// URI from the system file picker with a persisted read grant
 * (android/…/LinkedFilesPlugin.java), streamed through Capacitor's local server.
 * Web (dev server and e2e tests): there is no lasting file reference in a browser, so the picked
 * file is kept in a stand-in "device storage" folder, outside any book's data. Tests delete or
 * replace it there to act out a moved or edited file.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { readBytes, removeDir, writeBlob } from '../storage';

export interface LinkedFile {
  uri: string;
  /** File name when it was linked. */
  name: string;
  size: number;
}

export interface PickedFile extends LinkedFile {
  /** False when the file's provider can't grant lasting access (it must be found again after a restart). */
  persisted: boolean;
}

export type LinkedFileProblem = 'missing' | 'denied' | 'unreadable';

export class LinkedFileError extends Error {
  constructor(
    readonly problem: LinkedFileProblem,
    readonly fileName: string,
  ) {
    super(
      problem === 'denied'
        ? `The app no longer has access to “${fileName}”`
        : problem === 'missing'
          ? `“${fileName}” was moved, renamed or deleted`
          : `“${fileName}” couldn’t be read`,
    );
  }
}

interface LinkedFilesPlugin {
  pick(): Promise<{ cancelled: true } | ({ cancelled: false } & PickedFile)>;
  stat(options: { uri: string }): Promise<{ status: 'ok' | 'missing' | 'denied'; size?: number; name?: string }>;
  release(options: { uri: string }): Promise<void>;
  takeOpened(): Promise<{ file?: PickedFile }>;
  addListener(event: 'fileOpened', listener: (file: PickedFile) => void): Promise<unknown>;
}

const plugin = registerPlugin<LinkedFilesPlugin>('LinkedFiles');

export const WEB_SCHEME = 'web-device:';
export const WEB_DEVICE_DIR = 'device-files';

/** True where files are picked with the native picker (and can be linked). */
export const nativePicker = () => Capacitor.isNativePlatform();

/** Native only: the system file picker. Null if cancelled. */
export async function pickFile(): Promise<PickedFile | null> {
  const result = await plugin.pick();
  if (result.cancelled) return null;
  return { uri: result.uri, name: result.name, size: result.size ?? 0, persisted: result.persisted };
}

/**
 * Native only: calls `onOpened` for each file opened with or shared to the app (an EPUB from a
 * file manager's "Open with"), including the one it was launched with.
 */
export async function watchOpenedFiles(onOpened: (file: PickedFile) => void): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await plugin.addListener('fileOpened', onOpened);
  const { file } = await plugin.takeOpened();
  if (file) onOpened(file);
}

/** Web only: keeps a picked File in the stand-in device storage and returns a reference to it. */
export async function linkWebFile(file: File): Promise<PickedFile> {
  const id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const path = `${WEB_DEVICE_DIR}/${id}/${file.name.replace(/[/\\]/g, '_')}`;
  await writeBlob(path, file);
  return { uri: WEB_SCHEME + path, name: file.name, size: file.size, persisted: true };
}

/** Reads a linked file's bytes. Throws LinkedFileError if it's gone or no longer accessible. */
export async function readLinkedFile(file: Pick<LinkedFile, 'uri' | 'name'>): Promise<Uint8Array> {
  if (file.uri.startsWith(WEB_SCHEME)) {
    const bytes = await readBytes(file.uri.slice(WEB_SCHEME.length));
    if (!bytes) throw new LinkedFileError('missing', file.name);
    return bytes;
  }
  if (!Capacitor.isNativePlatform()) throw new LinkedFileError('missing', file.name);

  // Check first: the local server can only say "not found", not why.
  const { status } = await plugin.stat({ uri: file.uri }).catch(() => ({ status: 'missing' as const }));
  if (status !== 'ok') throw new LinkedFileError(status, file.name);
  try {
    const res = await fetch(Capacitor.convertFileSrc(file.uri));
    if (!res.ok) throw new Error(String(res.status));
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    throw new LinkedFileError('unreadable', file.name);
  }
}

/** Gives up the app's access to a linked file (the file itself is left alone). */
export async function releaseLinkedFile(uri: string): Promise<void> {
  if (uri.startsWith(WEB_SCHEME)) {
    // The stand-in only exists for the app, so remove it rather than leak browser storage.
    const path = uri.slice(WEB_SCHEME.length);
    await removeDir(path.slice(0, path.lastIndexOf('/')));
    return;
  }
  if (Capacitor.isNativePlatform()) await plugin.release({ uri }).catch(() => undefined);
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
