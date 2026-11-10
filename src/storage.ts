/** Thin wrapper over @capacitor/filesystem. Everything lives in the app's private data directory. */
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

const directory = Directory.Data;

export async function readText(path: string): Promise<string | null> {
  try {
    const { data } = await Filesystem.readFile({ path, directory, encoding: Encoding.UTF8 });
    return typeof data === 'string' ? data : await data.text();
  } catch {
    return null;
  }
}

export async function writeText(path: string, data: string): Promise<void> {
  await Filesystem.writeFile({ path, directory, data, encoding: Encoding.UTF8, recursive: true });
}

export async function readJson<T>(path: string): Promise<T | null> {
  const text = await readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function writeJson(path: string, value: unknown): Promise<void> {
  return writeText(path, JSON.stringify(value));
}

export async function readBytes(path: string): Promise<Uint8Array | null> {
  try {
    if (Capacitor.isNativePlatform()) {
      // Stream straight from disk through the WebView's local server instead of base64 over the bridge.
      const { uri } = await Filesystem.getUri({ path, directory });
      const res = await fetch(Capacitor.convertFileSrc(uri));
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    }
    const { data } = await Filesystem.readFile({ path, directory });
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Web only: Filesystem's web implementation stores Blobs directly. */
export async function writeBlob(path: string, blob: Blob): Promise<void> {
  await Filesystem.writeFile({ path, directory, data: blob, recursive: true });
}

export async function ensureDir(path: string): Promise<void> {
  try {
    await Filesystem.mkdir({ path, directory, recursive: true });
  } catch {
    // Already exists.
  }
}

/** Absolute file:// URI for native plugins that need a real path. */
export async function fileUri(path: string): Promise<string> {
  return (await Filesystem.getUri({ path, directory })).uri;
}

export async function removeFile(path: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path, directory });
  } catch {
    // Missing already.
  }
}

export async function removeDir(path: string): Promise<void> {
  try {
    await Filesystem.rmdir({ path, directory, recursive: true });
  } catch {
    // Missing already.
  }
}

export async function moveFile(from: string, to: string): Promise<void> {
  await removeFile(to);
  await Filesystem.rename({ from, to, directory, toDirectory: directory });
}
