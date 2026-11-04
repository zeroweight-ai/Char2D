import "server-only";
import { Unzip, UnzipInflate } from "fflate";
import { archivePathSchema, MAX_CHARACTER_ZIP_BYTES } from "@/lib/character-archive";

export class CharacterArchiveError extends Error { constructor(message: string, public status = 400) { super(message); } }
const MAX_FILES = 4096, MAX_UNPACKED = 300 * 1024 * 1024, MAX_FILE = 100 * 1024 * 1024;

/** No archive paths are written to disk; bound actual streamed output too. */
export function readCharacterZip(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_CHARACTER_ZIP_BYTES) throw new CharacterArchiveError("Character ZIPs must be 100 MB or smaller.", 413);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== bytes.readUInt16LE(end + 10) || bytes.readUInt32LE(end + 12) + bytes.readUInt32LE(end + 16) !== end)
    throw new CharacterArchiveError("This file is not a supported ZIP archive.");
  const expected = bytes.readUInt16LE(end + 10);
  if (!expected || expected > MAX_FILES) throw new CharacterArchiveError("The ZIP contains too many files.", 413);
  const files = new Map<string, Buffer>(), names = new Set<string>(), finished = new Set<string>();
  let total = 0, count = 0;
  const unzip = new Unzip(file => {
    const name = file.name.endsWith("/") ? file.name.slice(0, -1) : file.name;
    if (!archivePathSchema.safeParse(name).success || names.has(name)) throw new CharacterArchiveError("The ZIP contains an invalid or duplicate file path.");
    names.add(name);
    if (++count > MAX_FILES || (file.originalSize ?? 0) > MAX_FILE) throw new CharacterArchiveError("The ZIP expands beyond the allowed size.", 413);
    if (![0, 8].includes(file.compression)) throw new CharacterArchiveError("Use a ZIP with standard stored or deflated files.");
    const chunks: Buffer[] = [];
    let size = 0;
    file.ondata = (error, data, final) => {
      if (error) throw error;
      size += data.byteLength; total += data.byteLength;
      if (size > MAX_FILE || total > MAX_UNPACKED) { file.terminate(); throw new CharacterArchiveError("The ZIP expands beyond the allowed size.", 413); }
      chunks.push(Buffer.from(data));
      if (final) {
        if (file.originalSize !== undefined && size !== file.originalSize) throw new CharacterArchiveError("The ZIP contains an incomplete file.");
        finished.add(name);
        if (!file.name.endsWith("/")) files.set(name, Buffer.concat(chunks));
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for (let offset = 0; offset < bytes.length; offset += 65536) unzip.push(bytes.subarray(offset, offset + 65536), offset + 65536 >= bytes.length);
  } catch (error) {
    if (error instanceof CharacterArchiveError) throw error;
    throw new CharacterArchiveError("The ZIP is damaged or cannot be opened.");
  }
  if (count !== expected || finished.size !== count) throw new CharacterArchiveError("The ZIP contains incomplete files.");
  return files;
}
