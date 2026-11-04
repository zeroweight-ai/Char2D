import { importCharacterZip, CharacterArchiveError } from "@/server/characters/archive";
import { MAX_CHARACTER_ZIP_BYTES } from "@/lib/character-archive";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const maxBody = MAX_CHARACTER_ZIP_BYTES + 65536;
  if (Number(request.headers.get("content-length") ?? 0) > maxBody) return Response.json({ error: "Character ZIPs must be 100 MB or smaller." }, { status: 413 });
  try {
    if (!request.body) throw new CharacterArchiveError("Choose a character ZIP to upload.");
    const reader = request.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maxBody) { await reader.cancel(); throw new CharacterArchiveError("Character ZIPs must be 100 MB or smaller.", 413); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    let form: FormData;
    try { form = await new Response(new Uint8Array(Buffer.concat(chunks)), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData(); }
    catch { throw new CharacterArchiveError("Send a character ZIP using the upload form."); }
    const file = form.get("archive"), name = form.get("name");
    if (!(file instanceof File) || !file.size || !file.name.toLowerCase().endsWith(".zip")) throw new CharacterArchiveError("Choose a .zip character archive downloaded from Char2D.");
    if (file.size > MAX_CHARACTER_ZIP_BYTES) throw new CharacterArchiveError("Character ZIPs must be 100 MB or smaller.", 413);
    if (name !== null && typeof name !== "string") throw new CharacterArchiveError("Enter a valid character name.");
    const result = await importCharacterZip(Buffer.from(await file.arrayBuffer()), name ?? "");
    return Response.json(result, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof CharacterArchiveError ? error.message : "Could not import the character ZIP. Please try again." }, { status: error instanceof CharacterArchiveError ? error.status : 500 });
  }
}
