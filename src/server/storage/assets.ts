import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mkdirSync,writeFileSync,unlinkSync,readdirSync,rmdirSync,lstatSync } from "node:fs";
import { dirname, resolve, sep, join } from "node:path";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { config } from "../config";
import { getDatabase } from "../db";
import { assets } from "../db/schema";
const root = () => resolve(config.dataDir,"assets");
export function assetPath(relativePath: string) {
  const path = resolve(root(),relativePath);
  if (!path.startsWith(root()+sep)) throw new Error("Invalid asset path");
  return path;
}
export async function saveAsset(bytes: Buffer, options: { kind: string; mime: "image/png" | "image/webp" | "image/jpeg" | "application/json" | "audio/mpeg" | "audio/wav"; characterId?: string; width?: number; height?: number }) {
  const hash = createHash("sha256").update(bytes).digest("hex");
  const ext = { "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg", "application/json": "json", "audio/mpeg": "mp3", "audio/wav": "wav" }[options.mime];
  const path = `${hash.slice(0,2)}/${hash}.${ext}`;
  const absolute = assetPath(path);
  const asset = { id:nanoid(), characterId:options.characterId, kind:options.kind, path, mime:options.mime, width:options.width, height:options.height, bytes:bytes.length, sha256:hash, createdAt:Date.now() };
  const {db,sqlite}=getDatabase();
  // Serialize file creation and its DB reference with deletion cleanup. Otherwise
  // a same-hash save could race an unlink between writing and inserting its row.
  sqlite.transaction(()=>{
    mkdirSync(dirname(absolute),{recursive:true});
    try{writeFileSync(absolute,bytes,{flag:"wx"});}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}
    db.insert(assets).values(asset).run();
  }).immediate();
  return asset;
}
export async function readAsset(id: string) {
  const asset = getDatabase().db.select().from(assets).where(eq(assets.id,id)).get();
  if (!asset) return null;
  try{return { asset, bytes:await readFile(assetPath(asset.path)) };}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
}

export function pruneUnreferencedPaths(paths:string[]) {
  const {db,sqlite}=getDatabase();
  sqlite.transaction(()=>{
    for(const path of new Set(paths)){
      if(db.select({id:assets.id}).from(assets).where(eq(assets.path,path)).get())continue;
      try{unlinkSync(assetPath(path));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    }
    removeEmptyDirectories();
  }).immediate();
}

// Call while holding the same SQLite write lock used by saveAsset. Never follow
// symlinks, never remove the root, and use rmdir (not recursive rm) so a directory
// that acquires a file during traversal is preserved.
function removeEmptyDirectories():number {
  const assetRoot=root();
  try{if(!lstatSync(assetRoot).isDirectory())return 0;}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return 0;throw error;}
  let removed=0;
  function visit(directory:string) {
    let entries;
    try{entries=readdirSync(directory,{withFileTypes:true});}
    catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return;throw error;}
    for(const entry of entries)if(entry.isDirectory())visit(join(directory,entry.name));
    if(directory===assetRoot)return;
    try{rmdirSync(directory);removed++;}
    catch(error){if(!["ENOENT","ENOTEMPTY","EEXIST"].includes((error as NodeJS.ErrnoException).code??""))throw error;}
  }
  visit(assetRoot);return removed;
}
export function pruneEmptyAssetDirectories():number {
  return getDatabase().sqlite.transaction(removeEmptyDirectories).immediate();
}
