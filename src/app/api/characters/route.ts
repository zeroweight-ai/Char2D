import sharp from "sharp";
import { nanoid } from "nanoid";
import { desc, eq } from "drizzle-orm";
import { createCharacterSchema } from "@/lib/character";
import { getDatabase } from "@/server/db";
import { characters } from "@/server/db/schema";
import { config } from "@/server/config";
import { saveAsset } from "@/server/storage/assets";
import { chooseChromaKey, sampleColors } from "@/server/pixel/chroma";
import { getCharacter, queueSheet } from "@/server/characters/repository";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const MAX_UPLOAD=10*1024*1024;
export async function GET() {
  const list=getDatabase().db.select({id:characters.id}).from(characters).orderBy(desc(characters.createdAt)).all();
  return Response.json(list.map(row=>getCharacter(row.id)));
}
export async function POST(request:Request) {
  if(!config.fakeAI && !config.apiKey) return Response.json({error:"Configure your Muse API key in Settings before generating."},{status:503});
  const length=Number(request.headers.get("content-length") ?? 0);
  if(length>MAX_UPLOAD+65536) return Response.json({error:"Upload must be 10 MB or smaller."},{status:413});
  let form:FormData;
  try {
    if(!request.body) return Response.json({error:"A multipart form is required."},{status:400});
    const reader=request.body.getReader(),chunks:Uint8Array[]=[];
    let size=0;
    try {
      while(true) {
        const part=await reader.read();if(part.done)break;
        size+=part.value.byteLength;
        if(size>MAX_UPLOAD+65536) {await reader.cancel();return Response.json({error:"Upload must be 10 MB or smaller."},{status:413});}
        chunks.push(part.value);
      }
    } finally {reader.releaseLock();}
    const body=Buffer.concat(chunks);
    form=await new Response(new Uint8Array(body),{headers:{"Content-Type":request.headers.get("content-type") ?? ""}}).formData();
  } catch {return Response.json({error:"Send a multipart form with character details."},{status:400});}
  const parsed=createCharacterSchema.safeParse(Object.fromEntries(["mode","name","description","viewType"].map(key=>[key,form.get(key) ?? ""])));
  if(!parsed.success) return Response.json({error:parsed.error.issues[0].message},{status:400});
  const input=parsed.data;
  let png:Buffer|undefined;
  let samples:ReturnType<typeof sampleColors>=[];
  if(input.mode==="upload") {
    const file=form.get("image");
    if(!(file instanceof File) || !file.size) return Response.json({error:"Choose a PNG, JPEG, or WebP image."},{status:400});
    if(file.size>MAX_UPLOAD) return Response.json({error:"Upload must be 10 MB or smaller."},{status:413});
    if(!["image/png","image/jpeg","image/webp"].includes(file.type)) return Response.json({error:"Only PNG, JPEG, and WebP are supported."},{status:400});
    try {
      const bytes=Buffer.from(await file.arrayBuffer());
      const image=sharp(bytes,{limitInputPixels:24_000_000,animated:false});
      const metadata=await image.metadata();
      if(!["png","jpeg","webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1)>1) throw new Error("Unsupported image");
      png=await image.rotate().resize({width:2048,height:2048,fit:"inside",withoutEnlargement:true}).png().toBuffer();
      samples=sampleColors(await sharp(png).resize(128,128,{fit:"inside"}).ensureAlpha().raw().toBuffer());
    } catch {return Response.json({error:"The image cannot be decoded. Use a non-animated PNG, JPEG, or WebP under 24 megapixels."},{status:400});}
  }
  let key:string;
  try {key=chooseChromaKey(samples,input.description);} catch(error) {return Response.json({error:error instanceof Error ? error.message:"Could not select a safe background color"},{status:400});}
  const id=nanoid(),now=Date.now();
  const {db}=getDatabase();
  db.insert(characters).values({id,name:input.name,description:input.description,viewType:input.viewType,styleJson:JSON.stringify({chromaKey:key,colorSamples:samples,logicalHeight:input.logicalHeight,paletteSize:24,outline:false,mirrorLeft:true}),createdAt:now,updatedAt:now}).run();
  try {
    if(png) {
      const meta=await sharp(png).metadata();
      const asset=await saveAsset(png,{characterId:id,kind:"source",mime:"image/png",width:meta.width,height:meta.height});
      db.update(characters).set({sourceAssetId:asset.id}).where(eq(characters.id,id)).run();
    }
    const jobId=queueSheet(id);
    return Response.json({id,jobId},{status:202});
  } catch {
    db.update(characters).set({status:"error",updatedAt:Date.now()}).where(eq(characters.id,id)).run();
    return Response.json({error:"Could not queue character generation. Please try again."},{status:500});
  }
}
