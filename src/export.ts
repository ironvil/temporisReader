/**
 * Hands a generated file to the user: Android share sheet (save to Files, Drive, email…); in the web
 * version the browser's share sheet where it has one (iOS: Save to Files), otherwise a download.
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { WEB_APP } from './web-app';

export async function exportTextFile(fileName: string, text: string, mimeType = 'application/json'): Promise<void> {
  return exportFile(fileName, text, mimeType);
}

/** Text is written as UTF-8; bytes as they are. `verb` names the share sheet ("Export", "Share"). */
export async function exportFile(fileName: string, data: string | Uint8Array, mimeType: string, verb = 'Export'): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({
      path: `exports/${fileName}`,
      directory: Directory.Cache,
      ...(typeof data === 'string' ? { data, encoding: Encoding.UTF8 } : { data: toBase64(data) }),
      recursive: true,
    });
    await Share.share({ title: fileName, files: [uri], dialogTitle: `${verb} ${fileName}` });
    return;
  }
  if (WEB_APP && (await shareInBrowser(fileName, data, mimeType))) return;
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mimeType }));
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The browser's share sheet. False if there isn't one or it can't be shown now (then download). */
async function shareInBrowser(fileName: string, data: string | Uint8Array, mimeType: string): Promise<boolean> {
  const file = new File([data as BlobPart], fileName, { type: mimeType });
  if (!navigator.canShare?.({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: fileName });
    return true;
  } catch (err) {
    // Dismissed: callers ignore errors that mention "cancel". NotAllowedError: too long after the
    // tap (a big backup), so the browser won't show it; download instead.
    if (err instanceof DOMException && err.name === 'AbortError') throw new Error('Share cancelled');
    return false;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
