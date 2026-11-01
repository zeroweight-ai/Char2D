import "server-only";
import sharp from "sharp";
import type { NativePose } from "./native-frames";

// Match the upper quarter of Idle, rather than total silhouette dimensions:
// crouched legs, raised hands, extended weapons and VFX must not set body scale.
// Search in a small analysis image; only the final frame is resized, with nearest
// neighbour sampling. Raw generation assets remain untouched for reprocessing.
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

export async function alignCharacterScale(poses:NativePose[],idle:Buffer,idleScale:number) {
  const warnings:string[]=[];
  const aligned=await Promise.all(poses.map(async(pose,index)=>{
    const match=await measureCharacterScale(idle,pose.png);
    if(!match.confident){
      warnings.push(`Frame ${index+1}: could not confidently match Idle head details; preserved the original scale. Review character size.`);
      return pose;
    }
    const factor=1/match.ratio;
    const w=Math.max(1,Math.round(pose.rect.w*factor)),h=Math.max(1,Math.round(pose.rect.h*factor));
    const png=await sharp(pose.png).resize(w,h,{kernel:"nearest"}).png().toBuffer();
    return {...pose,png,rect:{x:Math.round(pose.rect.x*factor),y:Math.round(pose.rect.y*factor),w,h},baseline:pose.baseline*factor,scale:idleScale};
  }));
  return {poses:aligned,warnings};
}
