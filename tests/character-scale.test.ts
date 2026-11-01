import { expect,it } from "vitest";
import sharp from "sharp";
import { alignCharacterScale,measureCharacterScale } from "../src/server/pipeline/character-scale";

async function fixture(){
  const width=80,height=160,pixels=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(y<40&&x>=8+y%7&&x<65-y%11)pixels.set([220-y*3,90+x*2,(x*5+y*11)%255,255],(y*width+x)*4);
    else if(y>=40&&x>=24&&x<54)pixels.set([30,40,90,255],(y*width+x)*4);
  }
  return sharp(pixels,{raw:{width,height,channels:4}}).png().toBuffer();
}
it("matches enlarged head details and corrects the entire frame without trimming a weapon",async()=>{
  const idle=await fixture();
  const enlarged=await sharp(idle).resize(100,200,{kernel:"nearest"}).extend({left:0,top:0,bottom:0,right:100,background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
  const weapon=await sharp({create:{width:80,height:3,channels:4,background:"#ff7700"}}).png().toBuffer();
  const png=await sharp(enlarged).composite([{input:weapon,left:85,top:90}]).png().toBuffer();
  const match=await measureCharacterScale(idle,png);
  expect(match.confident).toBe(true);expect(match.ratio).toBeCloseTo(1.25,1);
  const result=await alignCharacterScale([{png,rect:{x:20,y:10,w:200,h:200},baseline:210,scale:1.4,airborne:false}],idle,1.1);
  expect(result.warnings).toEqual([]);
  expect(result.poses[0].scale).toBe(1.1);
  expect(Math.abs(result.poses[0].rect.h-160)).toBeLessThanOrEqual(8);
  expect(Math.abs(result.poses[0].rect.w-160)).toBeLessThanOrEqual(8);
  const {data,info}=await sharp(result.poses[0].png).raw().toBuffer({resolveWithObject:true});
  let orange=0;
  for(let i=0;i<data.length;i+=4)if(data[i]===255&&data[i+1]===119&&data[i+2]===0&&data[i+3]===255)orange++;
  expect(orange).toBeGreaterThan(80); // full scaled weapon remains, including its tip
  expect(info.width).toBe(result.poses[0].rect.w);
});
it("preserves scale and warns when no recognizable Idle head is found",async()=>{
  const idle=await fixture(),png=await sharp({create:{width:80,height:160,channels:4,background:"#00ff00"}}).png().toBuffer();
  const pose={png,rect:{x:0,y:0,w:80,h:160},baseline:160,scale:0.8,airborne:true};
  const result=await alignCharacterScale([pose],idle,1);
  expect(result.poses[0]).toBe(pose);expect(result.warnings).toHaveLength(1);
});
