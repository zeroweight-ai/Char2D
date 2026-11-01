// Original Char2D implementation: palette-distance key selection and chroma unmixing.
export const KEY_COLORS = ["#FF00FF", "#00FF00", "#00FFFF", "#0000FF"] as const;
type RGB = readonly [number,number,number];
export function hexRgb(hex:string): RGB {
  if(!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Invalid chroma key");
  return [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
}
const distance = (a:RGB,b:RGB) => Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const namedColors:Record<string,RGB> = {
  magenta:[255,0,255],pink:[255,100,190],purple:[150,40,190],violet:[140,30,220],
  green:[0,180,40],lime:[140,255,0],teal:[0,150,130],cyan:[0,255,255],turquoise:[30,200,190],
  blue:[0,0,255],navy:[0,30,100],red:[220,0,0],orange:[255,140,0],yellow:[255,230,0],
  gold:[230,180,40],brown:[110,65,30],white:[255,255,255],black:[0,0,0],silver:[190,190,190],gray:[128,128,128],grey:[128,128,128],
};
export function chooseChromaKey(samples:readonly RGB[],description=""):string {
  const words=description.toLowerCase().match(/[a-z]+/g) ?? [];
  const mentioned=words.flatMap(word => namedColors[word] ? [namedColors[word]]:[]);
  for(const hex of description.match(/#[0-9a-f]{6}\b/gi) ?? []) mentioned.push(hexRgb(hex));
  const colors=[...samples,...mentioned];
  // Maximize the distance to the nearest sampled or explicitly requested color.
  const score=(candidate:string) => colors.length ? Math.min(...colors.map(color => distance(hexRgb(candidate),color))) : (candidate==="#FF00FF" ? 255:0);
  const select=(candidates:readonly string[]) => candidates.reduce((best,key)=>score(key)>score(best) ? key:best,candidates[0]);
  let key=select(KEY_COLORS);
  // Fall back to other saturated cube colors when all preferred keys occur
  // in the source. Never knowingly key out a sampled character color.
  if(score(key)<150) key=select([...KEY_COLORS,"#FF0000","#FFFF00"]);
  if(score(key)<120) throw new Error("The image uses all available background key colors. Try a simpler crop or describe a more limited character palette.");
  return key;
}
export function sampleColors(rgba:Uint8Array):RGB[] {
  const colors=new Map<string,RGB>();
  // Quantize bins to avoid a huge palette and avoid losing rare accent colors.
  for(let i=0;i<rgba.length;i+=4) {
    if(rgba[i+3]<128) continue;
    const rgb:RGB=[rgba[i],rgba[i+1],rgba[i+2]];
    const key=rgb.map(c=>c>>4).join(",");
    colors.set(key,rgb);
  }
  return [...colors.values()];
}
export function removeChroma(rgba:Uint8Array,width:number,height:number,key:string) {
  if(rgba.length!==width*height*4) throw new Error("RGBA dimensions do not match");
  const rgb=hexRgb(key);
  const output=new Uint8Array(rgba);
  // Respect native transparency rather than keying colors out of the artwork.
  let existingTransparent=0;
  for(let i=3;i<rgba.length;i+=4) if(rgba[i]===0) existingTransparent++;
  if(existingTransparent>width*height*0.05) {
    if(existingTransparent>width*height*0.998) throw new Error("The generated image is empty.");
    return {rgba:output,transparentPixels:existingTransparent};
  }
  let transparent=0, visible=0, borderBackground=0, borderTotal=0;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=(y*width+x)*4;
    const color:RGB=[rgba[i],rgba[i+1],rgba[i+2]];
    const dist=distance(color,rgb);
    const border=x===0||y===0||x===width-1||y===height-1;
    if(border) borderTotal++;
    if(rgba[i+3]===0 || dist<=96) {
      output[i]=output[i+1]=output[i+2]=output[i+3]=0;
      transparent++;
      if(border) borderBackground++;
      continue;
    }
    if(output[i+3]>0) visible++;
  }
  // Only despill pixels adjacent to the removed background. Interior colors
  // must stay untouched, even if they share a hue with the key.
  const highChannels=[0,1,2].filter(c=>rgb[c]===255);
  const lowChannels=[0,1,2].filter(c=>rgb[c]===0);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=(y*width+x)*4;
    if(output[i+3]===0) continue;
    const neighbors=[...(x>0 ? [i-4]:[]),...(x+1<width ? [i+4]:[]),...(y>0 ? [i-width*4]:[]),...(y+1<height ? [i+width*4]:[])];
    if(!neighbors.some(j=>output[j+3]===0)) continue;
    const color:RGB=[rgba[i],rgba[i+1],rgba[i+2]];
    const dist=distance(color,rgb);
    const spill=Math.min(...highChannels.map(c=>color[c]))-Math.max(...lowChannels.map(c=>color[c]));
    if(dist<200 && spill>35) {
      const alpha=Math.max(0.05,Math.min(1,1-spill/255));
      for(let c=0;c<3;c++) output[i+c]=Math.max(0,Math.min(255,Math.round((color[c]-(1-alpha)*rgb[c])/alpha)));
      output[i+3]=Math.round(rgba[i+3]*alpha);
    }
  }
  if(borderBackground/Math.max(1,borderTotal)<0.85) throw new Error("The generated background is not flat or the character is clipped. Regenerate with more padding and a solid background.");
  if(transparent<width*height*0.05 || visible<width*height*0.002) throw new Error("Background removal could not isolate the character. Please regenerate the sheet.");
  return {rgba:output,transparentPixels:transparent};
}

// Pixel-art sprites use hard alpha. Discard partially keyed edge pixels before
// pose extraction so their despilled colors cannot become a new dark/colored rim
// during palette quantization. Fully opaque artwork is left untouched.
export function cleanSpriteAlpha(rgba:Uint8Array):Uint8Array {
  const output=new Uint8Array(rgba);
  for(let i=0;i<output.length;i+=4) {
    if(output[i+3]<192)output[i]=output[i+1]=output[i+2]=output[i+3]=0;
    else output[i+3]=255;
  }
  return output;
}
