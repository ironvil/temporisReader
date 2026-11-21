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
  if (!Capacitor.isNativePlatform()) return fetchToFile(url, path, onProgress);
  const listener = await FileTransfer.addListener('progress', (s) => {
    if (s.url === url) onProgress?.({ bytes: s.bytes, total: s.lengthComputable ? s.contentLength : 0 });
  });
  try {
    const dir = path.split('/').slice(0, -1).join('/');
    if (dir) await ensureDir(dir);
    await FileTransfer.downloadFile({ url, path: await fileUri(path), progress: true });
  } finally {
    await listener.remove();
  }
}

/**
 * Web: a plain fetch. (FileTransfer's web version also clicks a download link for the file, which
 * Safari opens in a window of its own.)
 */
async function fetchToFile(url: string, path: string, onProgress?: (p: DownloadProgress) => void): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let reported = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytes += value.length;
      // At most every 100 ms, as FileTransfer does: each report redraws the language's settings.
      if (Date.now() - reported >= 100) {
        reported = Date.now();
        onProgress?.({ bytes, total });
      }
    }
  } else {
    chunks.push(new Uint8Array(await res.arrayBuffer()));
  }
  onProgress?.({ bytes, total });
  await writeBlob(path, new Blob(chunks as BlobPart[]));
}

/** Decompresses gzip data (checked by magic bytes) and decodes as UTF-8. Plain text passes through. */
export async function gunzipText(bytes: Uint8Array): Promise<string> {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return new TextDecoder().decode(bytes);
}

/** Decompresses gzip data to bytes (checked by magic bytes; anything else passes through). */
export async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Splits a text stream into lines (without the newline), calling `onLine` for each. */
export async function forEachLine(stream: ReadableStream<string>, onLine: (line: string) => void): Promise<void> {
  const reader = stream.getReader();
  let rest = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = rest + value;
    let start = 0;
    for (let nl = text.indexOf('\n'); nl !== -1; nl = text.indexOf('\n', start)) {
      onLine(text.slice(start, nl));
      start = nl + 1;
    }
    rest = text.slice(start);
  }
  if (rest) onLine(rest);
}
