/** Hands a generated file to the user: Android share sheet (save to Files, Drive, email…) or a web download. */
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

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
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mimeType }));
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
