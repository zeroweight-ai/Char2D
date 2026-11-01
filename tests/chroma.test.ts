import { describe,expect,it } from "vitest";
import { chooseChromaKey, hexRgb, removeChroma, sampleColors } from "../src/server/pixel/chroma";
import { createCharacterSchema } from "../src/lib/character";
function image(key:string) {
  const color=hexRgb(key);
  const rgba=new Uint8Array(10*10*4);
  for(let i=0;i<rgba.length;i+=4) rgba.set([...color,255],i);
  for(let y=3;y<7;y++) for(let x=3;x<7;x++) rgba.set([20,100,35,255],(y*10+x)*4);
  return rgba;
}
describe("background selection",()=>{
  it("avoids character colors from uploads, names, and hex values",()=>{
    expect(chooseChromaKey([[255,0,255]])).not.toBe("#FF00FF");
    expect(chooseChromaKey([],"a magenta knight with pink armor")).not.toBe("#FF00FF");
    expect(chooseChromaKey([],"a knight with #FF00FF armor")).not.toBe("#FF00FF");
    expect(chooseChromaKey([],"a green knight")).not.toBe("#00FF00");
  });
  it("falls back when preferred colors overlap the source and rejects an unsafe palette",()=>{
    const preferred=["#FF00FF","#00FF00","#00FFFF","#0000FF"].map(hexRgb);
    expect(["#FF0000","#FFFF00"]).toContain(chooseChromaKey(preferred));
    expect(()=>chooseChromaKey([...preferred,hexRgb("#FF0000"),hexRgb("#FFFF00")])).toThrow(/all available/);
  });
  it("excludes transparent source pixels from the palette",()=>{
    expect(sampleColors(new Uint8Array([255,0,255,0,20,100,35,255]))).toEqual([[20,100,35]]);
  });
});
describe("background removal",()=>{
  it.each(["#FF00FF","#00FFFF","#0000FF"])("removes %s while preserving green clothing",key=>{
    const result=removeChroma(image(key),10,10,key);
    expect(result.transparentPixels).toBe(84);
    expect([...result.rgba.slice(0,4)]).toEqual([0,0,0,0]);
    expect([...result.rgba.slice((4*10+4)*4,(4*10+4)*4+4)]).toEqual([20,100,35,255]);
  });
  it("leaves interior key-adjacent hues fully opaque",()=>{
    const rgba=image("#0000FF");rgba.set([20,40,120,255],(4*10+4)*4);
    const result=removeChroma(rgba,10,10,"#0000FF");
    expect([...result.rgba.slice((4*10+4)*4,(4*10+4)*4+4)]).toEqual([20,40,120,255]);
  });
  it("removes background enclosed between limbs",()=>{
    const rgba=image("#FF00FF");rgba.set([255,0,255,255],(4*10+4)*4);
    expect(removeChroma(rgba,10,10,"#FF00FF").rgba[(4*10+4)*4+3]).toBe(0);
  });
  it("unmixes a magenta-contaminated black edge",()=>{
    const rgba=image("#FF00FF");rgba.set([128,0,128,255],(3*10+3)*4);
    const result=removeChroma(rgba,10,10,"#FF00FF");
    expect([...result.rgba.slice((3*10+3)*4,(3*10+3)*4+3)]).toEqual([0,0,0]);
    expect(result.rgba[(3*10+3)*4+3]).toBeCloseTo(127,0);
  });
  it("rejects missing/irregular backgrounds and empty images",()=>{
    expect(()=>removeChroma(image("#FF00FF"),10,10,"#00FF00")).toThrow(/not flat/);
    const rgba=image("#FF00FF");for(let i=0;i<rgba.length;i+=4)rgba.set([255,0,255,255],i);
    expect(()=>removeChroma(rgba,10,10,"#FF00FF")).toThrow(/isolate/);
  });
  it("preserves an already transparent image including character colors matching the key",()=>{
    const rgba=image("#FF00FF");for(let i=0;i<rgba.length;i+=4)if(rgba[i]===255)rgba[i+3]=0;
    rgba.set([255,0,255,255],(4*10+4)*4);
    expect(removeChroma(rgba,10,10,"#FF00FF").rgba).toEqual(rgba);
  });
});
it("requires a prompt only in prompt mode",()=>{
  const input={mode:"prompt",name:"Knight",description:"",viewType:"side_scroller"};
  expect(createCharacterSchema.safeParse(input).success).toBe(false);
  expect(createCharacterSchema.safeParse({...input,mode:"upload"}).success).toBe(true);
});

it("removes partially keyed edge pixels before quantization can turn them into an outline",async()=>{
  const {cleanSpriteAlpha}=await import("../src/server/pixel/chroma");
  expect([...cleanSpriteAlpha(new Uint8Array([40,0,40,135,20,100,35,255,10,30,10,230]))]).toEqual([0,0,0,0,20,100,35,255,10,30,10,255]);
});
