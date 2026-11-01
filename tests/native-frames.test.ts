import { expect,it } from "vitest";
import sharp from "sharp";
import { preserveNativeFrames } from "../src/server/pipeline/native-frames";
import { stripLayout,nativeBatchSize } from "../src/server/pipeline/guides";
import { previewViewport } from "../src/lib/anim/viewport";
import type { Manifest } from "../src/lib/manifest";
it("pads without changing source pixels or native dimensions",async()=>{
  const width=300,height=500,pixels=new Uint8Array(width*height*4);
  for(let i=0;i<width*height;i++)pixels.set([i%256,(i*13)%256,(i*31)%256,255],i*4);
  const png=await sharp(pixels,{raw:{width,height,channels:4}}).png().toBuffer();
  const [frame]=await preserveNativeFrames([{png,rect:{x:0,y:30,w:width,h:height},scale:2,baseline:560,airborne:true}]);
  expect(frame.w).toBe(302);expect(frame.h).toBe(502);expect(frame.anchorY).toBe(531);expect(frame.scale).toBe(2);
  expect(await sharp(frame.png).extract({left:1,top:1,width,height}).raw().toBuffer()).toEqual(Buffer.from(pixels));
});
it("sizes reference boxes to the native pose and uses smaller batches for large characters",()=>{
  const layout=stripLayout(4,{width:600,height:1100});
  expect(layout.poseHeight).toBe(1100);expect(layout.poseHeight/layout.height).toBeGreaterThan(0.85);expect(layout.poseHeight/layout.height).toBeLessThanOrEqual(0.9);
  expect(layout.slotWidth).toBeGreaterThan(600);expect(nativeBatchSize({width:600,height:1100},1920)).toBe(2);
});
it("fills the stage consistently for native and differently sized source frames",()=>{
  const frame={x:0,y:0,w:602,h:1102,anchorX:301,anchorY:1101,durationMs:100,scale:1};
  const manifest={actions:{idle:{directions:{right:{frames:[frame,{...frame,w:1204,h:2204,anchorX:602,anchorY:2202,scale:0.5}]}}}}} as unknown as Manifest;
  const viewport=previewViewport(manifest,960,600);
  expect(viewport.zoom*1102).toBeCloseTo(600*0.88,1);expect(viewport.x).toBe(480);
  expect(viewport.y-1101*viewport.zoom).toBeGreaterThanOrEqual(0);
});
it("expands wide/tall layouts without scaling the reference and offsets wide facing guides",()=>{
  const reference={width:300,height:500};
  const standard=stripLayout(1,reference);
  const right=stripLayout(2,reference,"wide","right"),left=stripLayout(2,reference,"wide","left");
  expect(right.slotWidth).toBe(Math.ceil(standard.slotWidth*1.65));
  expect((right.left+150)/right.slotWidth).toBeCloseTo(0.33,2);
  expect((left.left+150)/left.slotWidth).toBeCloseTo(0.67,2);
  expect(right.poseHeight).toBe(standard.poseHeight);
  expect(nativeBatchSize(reference,10000,"wide")).toBe(2);
  expect(stripLayout(1,reference,"tall").height).toBeGreaterThan(standard.height*1.5);
});
