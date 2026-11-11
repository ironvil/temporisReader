/**
 * Minimal read-only ZIP reader (enough for EPUB): reads the central directory, then inflates
 * entries on demand with the platform's DecompressionStream. No ZIP64, no encryption.
 */

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  /** Offset of the entry's local header. */
  offset: number;
  encrypted: boolean;
}

export class ZipError extends Error {}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export class ZipArchive {
  readonly entries = new Map<string, ZipEntry>();
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.readCentralDirectory();
  }

  private readCentralDirectory(): void {
    const { view, bytes } = this;
    // The end-of-central-directory record is in the last 22 + 65535 (comment) bytes.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
      if (view.getUint32(i, true) === EOCD_SIGNATURE) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipError('Not a ZIP file');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    if (count === 0xffff || p === 0xffffffff) throw new ZipError('ZIP64 archives are not supported');

    const utf8 = new TextDecoder('utf-8');
    for (let n = 0; n < count; n++) {
      if (p + 46 > bytes.length || view.getUint32(p, true) !== CENTRAL_SIGNATURE) throw new ZipError('The ZIP directory is damaged');
      const flags = view.getUint16(p + 8, true);
      const nameLength = view.getUint16(p + 28, true);
      const extraLength = view.getUint16(p + 30, true);
      const commentLength = view.getUint16(p + 32, true);
      const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLength));
      this.entries.set(name, {
        name,
        method: view.getUint16(p + 10, true),
        compressedSize: view.getUint32(p + 20, true),
        size: view.getUint32(p + 24, true),
        offset: view.getUint32(p + 42, true),
        encrypted: (flags & 1) !== 0,
      });
      p += 46 + nameLength + extraLength + commentLength;
    }
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  async read(name: string): Promise<Uint8Array> {
    const entry = this.entries.get(name);
    if (!entry) throw new ZipError(`Missing ${name}`);
    if (entry.encrypted) throw new ZipError(`${name} is encrypted`);
    const { view } = this;
    if (view.getUint32(entry.offset, true) !== LOCAL_SIGNATURE) throw new ZipError(`${name} is damaged`);
    const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
    const data = this.bytes.subarray(start, start + entry.compressedSize);
    if (data.length !== entry.compressedSize) throw new ZipError(`${name} is truncated`);
    if (entry.method === 0) return data;
    if (entry.method !== 8) throw new ZipError(`${name} uses an unsupported compression method`);
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
    try {
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      throw new ZipError(`${name} is damaged`);
    }
  }
}
