import "server-only";
import sharp from "sharp";
import type { Pose } from "./frames";
// batch: which generated strip the pose came from (frames of one strip share a scale).
export type NativePose=Pose&{scale:number;baseline:number;airborne:boolean;batch?:number};
export async function preserveNativeFrames(poses:NativePose[]) {
  return Promise.all(poses.map(async pose=>{
    const {data,info}=await sharp(pose.png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let mass=0,xMass=0;
    for(let y=Math.floor(info.height*0.7);y<info.height;y++)for(let x=0;x<info.width;x++){
      const alpha=data[(y*info.width+x)*4+3];if(alpha){mass+=alpha;xMass+=(x+0.5)*alpha;}
    }
    // Cropping and transparent padding only. No resizing, quantization, color
    // replacement, outline addition, or change to existing foreground pixels.
    const png=await sharp(pose.png).extend({top:1,bottom:1,left:1,right:1,background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
    return {png,w:info.width+2,h:info.height+2,anchorX:(mass?xMass/mass:info.width/2)+1,anchorY:(pose.airborne?pose.baseline-pose.rect.y:info.height)+1,scale:pose.scale};
  }));
}
