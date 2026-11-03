import "server-only";
import sharp from "sharp";
import type { NativePose } from "./native-frames";

// Match the upper quarter of Idle, rather than total silhouette dimensions:
// crouched legs, raised hands, extended weapons and VFX must not set body scale.
// Search in a small analysis image. Raw generation assets remain untouched.
export async function measureCharacterScale(reference:Buffer,target:Buffer) {
  const metadata=await sharp(reference).metadata();
  const unit=160/metadata.height!;
  const ref=await sharp(reference).resize({height:160,kernel:"nearest"}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const targetMeta=await sharp(target).metadata();
  const image=await sharp(target).resize(Math.max(1,Math.round(targetMeta.width!*unit)),Math.max(1,Math.round(targetMeta.height!*unit)),{kernel:"nearest"}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const samples:{x:number;y:number;r:number;g:number;b:number;a:number}[]=[];
  const headHeight=40,stride=Math.max(3,Math.ceil(Math.sqrt(ref.info.width*headHeight/400)));
  let opaque=0;
  for(let y=0;y<headHeight;y+=stride)for(let x=0;x<ref.info.width;x+=stride){
    const i=(y*ref.info.width+x)*4,a=ref.data[i+3];
    if(a>=128)opaque++;
    samples.push({x,y,r:ref.data[i],g:ref.data[i+1],b:ref.data[i+2],a});
  }
  let best={error:Infinity,ratio:1};
  if(opaque<20)return {...best,confident:false};
  for(let step=0;step<=40;step++){
    const ratio=0.65+step*0.025,width=Math.ceil(ref.info.width*ratio),height=Math.ceil(headHeight*ratio);
    for(let y=0;y<=Math.min(image.info.height-height,Math.round(image.info.height*0.55));y+=2)for(let x=0;x<=image.info.width-width;x+=2){
      let error=0;
      for(const sample of samples){
        const i=((y+Math.floor((sample.y+0.5)*ratio))*image.info.width+x+Math.floor((sample.x+0.5)*ratio))*4,alpha=image.data[i+3];
        if(sample.a<128)error+=alpha>=128?100:0;
        else if(alpha<128)error+=255;
        else error+=(Math.abs(sample.r-image.data[i])+Math.abs(sample.g-image.data[i+1])+Math.abs(sample.b-image.data[i+2]))/3;
      }
      error/=samples.length;
      if(error<best.error)best={error,ratio};
    }
  }
  // Abstain on changed/hidden heads, major redraws or an out-of-range scale.
  return {...best,confident:best.error<=50&&best.ratio>0.65&&best.ratio<1.65};
}

const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b),mid=sorted.length/2;return sorted.length%2?sorted[Math.floor(mid)]:(sorted[mid-1]+sorted[mid])/2;};
// Differences below this are measurement noise (the head search steps 2.5%).
export const SCALE_TOLERANCE=0.04;
// When no head can be matched, some actions still have a predictable body
// height relative to Idle. Crouch and most custom moves do not (that is the
// point of them), so those only get a warning instead of a guess.
const SILHOUETTE_FALLBACK:Record<string,{ratio:number;tolerance:number}>={walk:{ratio:1,tolerance:0.1}};

/**
 * Make one action's frames the same on-screen character size as a reference
 * (Idle frame 1). Muse redraws every strip from scratch and often zooms in,
 * e.g. a crouch drawn to fill the standing guide box. The head is the one part
 * whose size never legitimately changes, so it sets the scale; the pose's own
 * bounds (bent legs, weapons, VFX) never do.
 *
 * Only `scale` changes: native pixels are kept untouched (no resampling), the
 * renderer multiplies by `scale`. Frames from one generated strip (a batch)
 * share a single correction, the median of their confident head matches, so a
 * noisy match on one frame cannot make the character pulse between frames.
 */
export async function alignActionScale(poses:NativePose[],reference:{png:Buffer;scale:number},options:{actionKey:string;label?:string;direction?:string;fixedBatches?:number[]}) {
  const warnings:string[]=[],name=`${options.label??options.actionKey}${options.direction?` ${options.direction}`:""}`;
  if(!poses.length)return {poses,warnings,corrections:[] as number[]};
  const matches=await Promise.all(poses.map(pose=>measureCharacterScale(reference.png,pose.png)));
  // Head size relative to the reference, in logical (on-screen) units.
  const relative=matches.map((match,i)=>match.confident?match.ratio*poses[i].scale/reference.scale:undefined);
  const confident=relative.filter((value):value is number=>value!==undefined);
  let overall=confident.length?median(confident):undefined;
  const fallback=SILHOUETTE_FALLBACK[options.actionKey];
  if(overall===undefined&&fallback){
    const meta=await sharp(reference.png).metadata();
    const measured=median(poses.map(pose=>pose.rect.h*pose.scale))/(meta.height!*reference.scale)/fallback.ratio;
    if(Math.abs(measured-1)>fallback.tolerance){overall=measured;warnings.push(`${name}: could not match Idle's head; matched body height to Idle instead (${Math.round(measured*100)}% before correction). Review character size.`);}
    else overall=1;
  }
  const batches=new Map<number,number[]>();
  poses.forEach((pose,i)=>{const batch=pose.batch??0;if(!batches.has(batch))batches.set(batch,[]);batches.get(batch)!.push(i);});
  const corrections=poses.map(()=>1);
  for(const [batch,indices] of batches){
    if(options.fixedBatches?.includes(batch))continue;
    const own=indices.map(i=>relative[i]).filter((value):value is number=>value!==undefined);
    const ratio=own.length?median(own):overall;
    if(ratio===undefined){warnings.push(`${name}: frames ${indices[0]+1}–${indices[indices.length-1]+1} could not be matched to Idle's head; kept their drawn size. Review character size.`);continue;}
    if(Math.abs(ratio-1)<=SCALE_TOLERANCE)continue;
    for(const i of indices)corrections[i]=1/ratio;
  }
  return {poses:poses.map((pose,i)=>corrections[i]===1?pose:{...pose,scale:pose.scale*corrections[i]}),warnings,corrections};
}
