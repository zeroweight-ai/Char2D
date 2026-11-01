import "server-only";
import { eq } from "drizzle-orm";
import { getDatabase } from "../db";
import { assets } from "../db/schema";
import { nativeBatchSize } from "./guides";
import { MAX_FRAMES_PER_STRIP } from "./presets";
export function estimateStripCalls(sheet:{processedAssetId:string|null;anchorsJson:string},frames:number,directions:string[],actionCanvas:"standard"|"wide"|"tall"="standard"):number {
  const {db}=getDatabase(),anchors=JSON.parse(sheet.anchorsJson);
  const canvas=sheet.processedAssetId?db.select({width:assets.width}).from(assets).where(eq(assets.id,sheet.processedAssetId)).get():null;
  return [...new Set(directions)].reduce((sum,direction)=>{
    const asset=anchors[direction]?db.select({width:assets.width,height:assets.height}).from(assets).where(eq(assets.id,anchors[direction])).get():null;
    const batch=asset?.width&&asset.height?nativeBatchSize({width:asset.width,height:asset.height},canvas?.width??1920,actionCanvas):actionCanvas==="wide"?2:MAX_FRAMES_PER_STRIP;
    return sum+Math.ceil(frames/batch);
  },0);
}
