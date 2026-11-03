import { expect,it } from "vitest";
import sharp from "sharp";
import { alignActionScale,measureCharacterScale } from "../src/server/pipeline/character-scale";

async function fixture(){
  const width=80,height=160,pixels=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(y<40&&x>=8+y%7&&x<65-y%11)pixels.set([220-y*3,90+x*2,(x*5+y*11)%255,255],(y*width+x)*4);
    else if(y>=40&&x>=24&&x<54)pixels.set([30,40,90,255],(y*width+x)*4);
  }
  return sharp(pixels,{raw:{width,height,channels:4}}).png().toBuffer();
}
const pose=(png:Buffer,w:number,h:number,extra:Partial<{scale:number;batch:number;airborne:boolean}>={})=>({png,rect:{x:0,y:0,w,h},baseline:h,scale:1,airborne:false,...extra});
async function enlarged(idle:Buffer,factor:number){
  const w=Math.round(80*factor),h=Math.round(160*factor);
  const body=await sharp(idle).resize(w,h,{kernel:"nearest"}).extend({left:0,top:0,bottom:0,right:100,background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
  const weapon=await sharp({create:{width:80,height:3,channels:4,background:"#ff7700"}}).png().toBuffer();
  return {png:await sharp(body).composite([{input:weapon,left:w-15,top:Math.round(h*0.45)}]).png().toBuffer(),w:w+100,h};
}
it("matches enlarged head details, ignoring a weapon that widens the silhouette",async()=>{
  const idle=await fixture(),{png}=await enlarged(idle,1.25);
  const match=await measureCharacterScale(idle,png);
  expect(match.confident).toBe(true);expect(match.ratio).toBeCloseTo(1.25,1);
});
it("corrects a zoomed-in action by scale only, keeping native pixels untouched",async()=>{
  const idle=await fixture(),{png,w,h}=await enlarged(idle,1.25);
  const input=pose(png,w,h,{scale:1.4});
  const result=await alignActionScale([input],{png:idle,scale:1.1},{actionKey:"crouch"});
  expect(result.warnings).toEqual([]);
  // On-screen head size now equals Idle's: native 1.25× × new scale = 1.1.
  expect(result.poses[0].scale*1.25).toBeCloseTo(1.1,1);
  expect(result.poses[0].png).toBe(png);expect(result.poses[0].rect).toEqual(input.rect);
});
it("uses one correction per generated strip so frames cannot pulse",async()=>{
  const idle=await fixture(),big=await enlarged(idle,1.3),same=await enlarged(idle,1);
  const blank=await sharp({create:{width:80,height:160,channels:4,background:"#00ff00"}}).png().toBuffer();
  const poses=[pose(same.png,same.w,same.h,{batch:0}),pose(same.png,same.w,same.h,{batch:0}),pose(big.png,big.w,big.h,{batch:1}),pose(blank,80,160,{batch:1})];
  const result=await alignActionScale(poses,{png:idle,scale:1},{actionKey:"jump"});
  expect(result.poses[0]).toBe(poses[0]);expect(result.poses[1]).toBe(poses[1]);
  // The unmatched frame shares its strip's correction instead of keeping its size.
  expect(result.poses[2].scale).toBeCloseTo(1/1.3,1);expect(result.poses[3].scale).toBe(result.poses[2].scale);
});
it("leaves fixed batches (Idle's first strip) alone",async()=>{
  const idle=await fixture(),big=await enlarged(idle,1.3);
  const poses=[pose(big.png,big.w,big.h,{batch:0}),pose(big.png,big.w,big.h,{batch:1})];
  const result=await alignActionScale(poses,{png:idle,scale:1},{actionKey:"idle",fixedBatches:[0]});
  expect(result.poses[0]).toBe(poses[0]);expect(result.poses[1].scale).toBeCloseTo(1/1.3,1);
});
it("keeps scale and warns when no Idle head is found, except walk which falls back to body height",async()=>{
  const idle=await fixture(),png=await sharp({create:{width:80,height:240,channels:4,background:"#00ff00"}}).png().toBuffer();
  const input=pose(png,80,240,{scale:0.8,airborne:true});
  const crouch=await alignActionScale([input],{png:idle,scale:1},{actionKey:"crouch"});
  expect(crouch.poses[0]).toBe(input);expect(crouch.warnings).toHaveLength(1);
  // Walk: 240×0.8=192 logical vs Idle 160 → scaled down to Idle's height.
  const walk=await alignActionScale([input],{png:idle,scale:1},{actionKey:"walk"});
  expect(walk.poses[0].scale*240).toBeCloseTo(160,0);expect(walk.warnings[0]).toMatch(/body height/);
});
