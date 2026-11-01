import { expect,it } from "vitest";
import sharp from "sharp";
import { extractPoses,normalizePoses,buildPalette } from "../src/server/pipeline/frames";
async function fixture(fused=false) {
  const width=60,height=30,data=new Uint8Array(width*height*4);
  for(const start of [5,25,45])for(let y=5;y<25;y++)for(let x=start;x<start+10;x++)data.set([10,120,40,255],(y*width+x)*4);
  if(fused)for(let x=15;x<45;x++)for(let y=5;y<25;y++)data.set([10,120,40,255],(y*width+x)*4);
  return sharp(data,{raw:{width,height,channels:4}}).png().toBuffer();
}
it("extracts ordered pose bounds and registers logical frames at a common baseline",async()=>{
  const extracted=await extractPoses(await fixture(),3);
  expect(extracted.poses.map(p=>p.rect.x)).toEqual([5,25,45]);
  const palette=buildPalette([new Uint8Array([10,120,40,255,0,0,0,0])]);expect(palette).toEqual(["#0a7828"]);
  const frames=await normalizePoses(extracted.poses,palette,{height:48,cellW:64,cellH:80,outline:true});
  for(const frame of frames){expect(frame.anchorY).toBe(72);const pixels=await sharp(frame.png).ensureAlpha().raw().toBuffer();let bottom=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])bottom=Math.floor(i/4/64);expect(bottom).toBe(72);}
});
it("rejects fused poses when no safe projection boundary exists",async()=>{
  await expect(extractPoses(await fixture(true),3)).rejects.toThrow("extract_mismatch");
});
it("caps a rich source palette at the requested color budget",()=>{
  const pixels=new Uint8Array(256*4);for(let i=0;i<256;i++)pixels.set([i,255-i,(i*31)%256,255],i*4);
  expect(buildPalette([pixels],24)).toHaveLength(24);
});

it("tightly crops frames without adding outline pixels and preserves the crop-adjusted pivot",async()=>{
  const {poses}=await extractPoses(await fixture(),3);
  const frames=await normalizePoses(poses,["#0a7828","#000000"],{height:48,cellW:64,cellH:80,outline:false,tight:true});
  for(const frame of frames){
    expect(frame.w).toBe(26);expect(frame.h).toBe(50);expect(frame.anchorY).toBe(49);
    const pixels=await sharp(frame.png).ensureAlpha().raw().toBuffer();
    let visible=0;
    for(let y=0;y<frame.h;y++)for(let x=0;x<frame.w;x++){
      const i=(y*frame.w+x)*4;
      if(pixels[i+3]){visible++;expect([...pixels.slice(i,i+3)]).toEqual([10,120,40]);}
      if(x===0||y===0||x===frame.w-1||y===frame.h-1)expect(pixels[i+3]).toBe(0);
    }
    expect(visible).toBe(24*48);
  }
});
it("preserves design height for wide characters instead of shrinking to a fixed cell width",async()=>{
  const png=await sharp({create:{width:100,height:20,channels:4,background:{r:10,g:120,b:40,alpha:1}}}).png().toBuffer();
  const frames=await normalizePoses([{png,rect:{x:0,y:0,w:100,h:20}}],["#0a7828"],{height:64,cellW:80,cellH:96,tight:true});
  expect(frames[0].h).toBe(66);expect(frames[0].w).toBe(322);
});
it("rebases variable-resolution strip batches to the same pixel scale",async()=>{
  const {rescalePoseSpace}=await import("../src/server/pipeline/frames");
  const small=await sharp({create:{width:10,height:20,channels:4,background:{r:10,g:120,b:40,alpha:1}}}).png().toBuffer();
  const large=await sharp(small).resize(20,40,{kernel:"nearest"}).png().toBuffer();
  const first=await rescalePoseSpace([{png:small,rect:{x:10,y:5,w:10,h:20}}],100);
  const second=await rescalePoseSpace([{png:large,rect:{x:20,y:10,w:20,h:40}}],200);
  expect(second[0].rect).toEqual(first[0].rect);
  expect(second[0].png).toEqual(first[0].png);
});

it("isolates disconnected poses with overlapping bounds without copying neighboring pixels",async()=>{
  const width=60,height=30,pixels=new Uint8Array(width*height*4);
  const draw=(x:number,y:number,w:number,h:number,color:number[])=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)pixels.set([...color,255],(yy*width+xx)*4);};
  // Two large bodies remain separate, but their thin props overlap in X.
  draw(3,5,10,20,[255,0,0]);draw(12,5,14,2,[255,0,0]);
  draw(20,10,10,15,[0,255,0]);draw(29,22,13,2,[0,255,0]);
  draw(38,5,10,15,[0,0,255]);
  const png=await sharp(pixels,{raw:{width,height,channels:4}}).png().toBuffer();
  const result=await extractPoses(png,3);expect(result.poses).toHaveLength(3);
  expect(result.poses[0].rect.x+result.poses[0].rect.w).toBeGreaterThan(result.poses[1].rect.x);
  let total=0;
  for(let index=0;index<3;index++){
    const data=await sharp(result.poses[index].png).ensureAlpha().raw().toBuffer();
    const expected=[[255,0,0],[0,255,0],[0,0,255]][index];
    for(let i=0;i<data.length;i+=4)if(data[i+3]){total++;expect([...data.slice(i,i+3)]).toEqual(expected);}
  }
  const original=Array.from(pixels).filter((value,index)=>index%4===3&&value>0).length;
  expect(total).toBe(original);
});

it("uses a curved seam around thin touching props but still isolates the poses",async()=>{
  const width=120,height=100,pixels=new Uint8Array(width*height*4);
  const draw=(x:number,y:number,w:number,h:number,color:number[])=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)pixels.set([...color,255],(yy*width+xx)*4);};
  draw(3,5,20,90,[255,0,0]);draw(53,5,20,90,[0,255,0]);draw(83,5,20,90,[0,0,255]);
  // Staggered horizontal props fill every possible straight cut, while a
  // curved path can go around them and cross only one thin bridge.
  draw(22,10,24,31,[255,0,0]);draw(35,65,26,20,[0,255,0]);draw(22,52,39,1,[255,0,0]);
  const png=await sharp(pixels,{raw:{width,height,channels:4}}).png().toBuffer();
  const result=await extractPoses(png,3);expect(result.poses).toHaveLength(3);
  expect(result.poses.every(p=>p.rect.w>0&&p.rect.h>0)).toBe(true);
  expect(result.warnings.some(w=>w.includes("curved"))).toBe(true);
});

it("preserves wide weapon tips and single-pixel detached VFX in explicit slots",async()=>{
  const {extractSlotPoses}=await import("../src/server/pipeline/frames");
  const width=200,height=60,pixels=Buffer.alloc(width*height*4);
  for(const offset of [0,100]) {
    for(let y=15;y<50;y++)for(let x=10;x<35;x++)pixels.set([200,100,50,255],(y*width+x+offset)*4);
    for(let x=35;x<94;x++)pixels.set([255,255,255,255],(25*width+x+offset)*4);
    pixels.set([0,255,255,255],(10*width+95+offset)*4);
  }
  const png=await sharp(pixels,{raw:{width,height,channels:4}}).png().toBuffer();
  const result=await extractSlotPoses(png,2);
  expect(result.poses.map(p=>p.rect.w)).toEqual([86,86]);
  const restored=await sharp(result.poses[0].png).raw().toBuffer();
  expect([...restored.subarray(85*4,85*4+4)]).toEqual([0,255,255,255]);
  pixels.set([255,255,255,255],(25*width+99)*4);
  const edged=await sharp(pixels,{raw:{width,height,channels:4}}).png().toBuffer();
  // A real blank gap replaces the ideal center cut; foreground stays intact.
  expect((await extractSlotPoses(edged,2)).poses).toHaveLength(2);
  pixels.set([255,255,255,255],(25*width)*4);
  const outerEdge=await sharp(pixels,{raw:{width,height,channels:4}}).png().toBuffer();
  expect((await extractSlotPoses(outerEdge,2)).warnings[0]).toContain("touches a slot edge");
  await expect(extractSlotPoses(outerEdge,2,{retryEdgeContact:true})).rejects.toThrow("touches a slot edge");
});
