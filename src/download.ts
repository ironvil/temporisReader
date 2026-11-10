/** Downloads a URL into app storage, with progress. Native downloads bypass WebView CORS. */
import { Capacitor } from '@capacitor/core';
import { FileTransfer } from '@capacitor/file-transfer';
import { ensureDir, fileUri, writeBlob } from './storage';

export interface DownloadProgress {
  bytes: number;
  /** 0 when the server didn't send a length. */
  total: number;
}

export async function downloadToFile(
  url: string,
  path: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  const listener = await FileTransfer.addListener('progress', (s) => {
    if (s.url === url) onProgress?.({ bytes: s.bytes, total: s.lengthComputable ? s.contentLength : 0 });
  });
  try {
    if (Capacitor.isNativePlatform()) {
      const dir = path.split('/').slice(0, -1).join('/');
      if (dir) await ensureDir(dir);
      await FileTransfer.downloadFile({ url, path: await fileUri(path), progress: true });
    } else {
      const { blob } = await FileTransfer.downloadFile({ url, path, progress: true });
      if (!blob) throw new Error('Download returned no data');
      await writeBlob(path, blob);
    }
  } finally {
    await listener.remove();
  }
}

/** Decompresses gzip data (checked by magic bytes) and decodes as UTF-8. Plain text passes through. */
export async function gunzipText(bytes: Uint8Array): Promise<string> {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return new TextDecoder().decode(bytes);
}
