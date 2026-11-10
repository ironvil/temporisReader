/** Hands a generated text file to the user: Android share sheet (save to Files, Drive, email…) or a web download. */
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export async function exportTextFile(fileName: string, text: string, mimeType = 'application/json'): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({
      path: `exports/${fileName}`,
      directory: Directory.Cache,
      data: text,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    await Share.share({ title: fileName, files: [uri], dialogTitle: `Export ${fileName}` });
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
