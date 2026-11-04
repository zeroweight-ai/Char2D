import { exportCharacterZip, CharacterArchiveError } from "@/server/characters/archive";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = await exportCharacterZip((await params).id);
    return new Response(new Uint8Array(result.bytes), { headers: {
      "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Content-Length": String(result.bytes.length), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return Response.json({ error: error instanceof CharacterArchiveError ? error.message : "Could not export the character ZIP." }, { status: error instanceof CharacterArchiveError ? error.status : 500 });
  }
}
