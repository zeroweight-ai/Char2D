import { readAsset } from "@/server/storage/assets";
export const runtime = "nodejs";
export async function GET(request:Request,{ params }:{params:Promise<{id:string}>}) {
  const { id } = await params;
  const result = await readAsset(id);
  if (!result) return Response.json({error:"Asset not found"},{status:404});
  const headers = {"Content-Type":result.asset.mime,"Cache-Control":"public, max-age=31536000, immutable",ETag:`"${result.asset.sha256}"`,"X-Content-Type-Options":"nosniff"};
  if (request.headers.get("if-none-match")===headers.ETag) return new Response(null,{status:304,headers});
  return new Response(new Uint8Array(result.bytes),{headers});
}
