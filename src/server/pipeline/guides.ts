import "server-only";
import { DEFAULT_POSE_RESOLUTION, POSE_HEIGHT_RATIO } from "@/lib/resolution";
import sharp from "sharp";
import { MAX_FRAMES_PER_STRIP } from "./presets";
export type ActionCanvas="standard"|"wide"|"tall";
type Facing="right"|"left"|"up"|"down";
export function stripLayout(frames:number,reference:{width:number;height:number}=DEFAULT_POSE_RESOLUTION,canvas:ActionCanvas="standard",direction:Facing="right",safetyScale=1) {
  if(!Number.isInteger(frames)||frames<1||frames>MAX_FRAMES_PER_STRIP)throw new Error("A layout guide supports one to four frames");
  if(!Number.isFinite(safetyScale)||safetyScale<1)throw new Error("Invalid safety scale");
  if(reference.width<1||reference.height<1)throw new Error("Invalid reference dimensions");
  const height=Math.ceil(reference.height/POSE_HEIGHT_RATIO*(canvas==="tall"?1.6:1)*safetyScale),slotWidth=Math.ceil(Math.ceil(Math.max(reference.width/POSE_HEIGHT_RATIO,reference.height*0.75))*(canvas==="wide"?1.65:1)*safetyScale);
  const rootRatio=canvas==="wide"?(direction==="right"?0.33:direction==="left"?0.67:0.5):0.5;
  const left=Math.max(0,Math.min(slotWidth-reference.width,Math.round(slotWidth*rootRatio-reference.width/2)));
  return {width:frames*slotWidth,height,slotWidth,poseWidth:reference.width,poseHeight:reference.height,left,top:canvas==="tall"?Math.floor(height-reference.height-height*0.06):Math.floor((height-reference.height)/2)};
}
export async function stripGuide(frames:number,key:string,reference?:{width:number;height:number},canvas:ActionCanvas="standard",direction:Facing="right",safetyScale=1) {
  const layout=stripLayout(frames,reference,canvas,direction,safetyScale);
  const boxes=Array.from({length:frames},(_,i)=>`<rect x="${i*layout.slotWidth+layout.left}" y="${layout.top}" width="${layout.poseWidth}" height="${layout.poseHeight}" fill="none" stroke="#777" stroke-opacity="0.15"/>`).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}"><rect width="100%" height="100%" fill="${key}"/>${boxes}</svg>`)).png().toBuffer();
}

// Use the accepted sheet's observed canvas width as a conservative batch
// budget. Large native poses may need 1–2 frames rather than a wide 4-frame
// image that the generator would fit into fewer pixels vertically.
export function nativeBatchSize(reference:{width:number;height:number},canvasWidth:number,canvas:ActionCanvas="standard") {
  return Math.max(1,Math.min(canvas==="wide"?2:MAX_FRAMES_PER_STRIP,Math.floor(canvasWidth/stripLayout(1,reference,canvas).slotWidth)));
}
