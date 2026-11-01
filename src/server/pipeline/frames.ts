import "server-only";
import sharp from "sharp";
export type Pose={png:Buffer;rect:{x:number;y:number;w:number;h:number}};
// Original Char2D connected-component extraction. Small detached pieces are
// assigned to the nearest pose. Projection valleys provide a fused-pose fallback.
export async function extractPoses(png:Buffer,count:number):Promise<{poses:Pose[];warnings:string[]}> {
  const {data,info}=await sharp(png,{limitInputPixels:24_000_000}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {width:w,height:h}=info,labels=new Int32Array(w*h),work=new Int32Array(w*h);
  type Box={x:number;y:number;r:number;b:number;area:number;ids:number[];slot?:number};
  let nextLabel=0;
  const boxes:Box[]=[];
  for(let p=0;p<w*h;p++) {
    if(labels[p]||data[p*4+3]<128)continue;
    const label=++nextLabel;
    let head=0,tail=1;work[0]=p;labels[p]=label;
    const box:Box={x:p%w,y:Math.floor(p/w),r:p%w,b:Math.floor(p/w),area:0,ids:[label]};
    while(head<tail) {
      const q=work[head++],x=q%w,y=Math.floor(q/w);box.area++;box.x=Math.min(box.x,x);box.y=Math.min(box.y,y);box.r=Math.max(box.r,x);box.b=Math.max(box.b,y);
      for(const n of [x>0?q-1:-1,x+1<w?q+1:-1,y>0?q-w:-1,y+1<h?q+w:-1])if(n>=0&&!labels[n]&&data[n*4+3]>=128){labels[n]=label;work[tail++]=n;}
    }
    if(box.area>=3)boxes.push(box);
  }
  boxes.sort((a,b)=>b.area-a.area);
  let selected=boxes.slice(0,count).map(b=>({...b}));
  const warnings:string[]=[];
  const valid=selected.length===count&&selected.every(b=>b.area>=Math.max(3,boxes[0].area*0.1))&&(!boxes[count]||boxes[count].area<selected[count-1].area*0.35);
  if(valid) {
    for(const part of boxes.slice(count)) {
      if(part.area<Math.max(3,boxes[0].area*0.002))continue;
      const nearest=selected.reduce((a,b)=>Math.abs((a.x+a.r)-(part.x+part.r))<Math.abs((b.x+b.r)-(part.x+part.r))?a:b);
      nearest.ids.push(...part.ids);
      nearest.x=Math.min(nearest.x,part.x);nearest.y=Math.min(nearest.y,part.y);nearest.r=Math.max(nearest.r,part.r);nearest.b=Math.max(nearest.b,part.b);
    }
    selected.sort((a,b)=>a.x-b.x);
    // Overlapping bounding rectangles are valid when the actual pixel
    // components are disconnected (for example, a wide staff or cape).
  } else selected=[];
  const useComponentMasks=selected.length>0;
  let fallbackCuts:number[][]=[];
  if(!selected.length) {
    const projection=new Uint32Array(w);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(data[(y*w+x)*4+3]>=128)projection[x]++;
    const cuts=[Array(h).fill(0) as number[]];
    let curved=false;
    for(let i=1;i<count;i++) {
      const target=w*i/count,lo=Math.max(1,Math.floor(target-w/count*0.3)),hi=Math.min(w-1,Math.ceil(target+w/count*0.3));
      let cut=lo;
      for(let x=lo+1;x<=hi;x++)if(projection[x]+Math.abs(x-target)*0.02<projection[cut]+Math.abs(cut-target)*0.02)cut=x;
      let seam=Array(h).fill(cut) as number[];
      if(projection[cut]>Math.max(2,h*0.04)) {
        seam=separationSeam(data,w,h,lo,hi,target);curved=true;
        const crossed=seam.reduce((sum,x,y)=>sum+(data[(y*w+x)*4+3]>=128?1:0),0);
        if(crossed>Math.max(2,h*0.04))throw new Error(`extract_mismatch: expected ${count} separated poses; poses overlap too much to separate safely. Request more spacing between the poses.`);
      }
      cuts.push(seam);
    }
    cuts.push(Array(h).fill(w));selected=[];
    fallbackCuts=cuts;
    for(let slot=0;slot<count;slot++) {
      const box:Box={x:w,y:h,r:-1,b:-1,area:0,ids:[],slot};
      for(let y=0;y<h;y++)for(let x=cuts[slot][y]+(slot?1:0);x<cuts[slot+1][y];x++)if(data[(y*w+x)*4+3]>=128){box.x=Math.min(box.x,x);box.y=Math.min(box.y,y);box.r=Math.max(box.r,x);box.b=Math.max(box.b,y);box.area++;}
      if(box.area<3)throw new Error(`extract_mismatch: pose ${slot+1} is empty`);
      selected.push(box);
    }
    warnings.push(curved?"Used a curved separation seam; review touching props and pose edges.":"Used projection segmentation; inspect pose boundaries.");
  }
  const poses:Pose[]=[];
  for(const box of selected) {
    const rect={x:box.x,y:box.y,w:box.r-box.x+1,h:box.b-box.y+1};
    if(useComponentMasks) {
      const owned=new Set(box.ids),pixels=new Uint8Array(rect.w*rect.h*4);
      for(let y=0;y<rect.h;y++)for(let x=0;x<rect.w;x++){
        const source=((rect.y+y)*w+rect.x+x)*4;
        if(owned.has(labels[source/4]))pixels.set(data.subarray(source,source+4),(y*rect.w+x)*4);
      }
      poses.push({png:await sharp(pixels,{raw:{width:rect.w,height:rect.h,channels:4}}).png().toBuffer(),rect});
    } else {
      const slot=box.slot!,pixels=new Uint8Array(rect.w*rect.h*4);
      for(let y=0;y<rect.h;y++)for(let x=0;x<rect.w;x++){
        const sx=rect.x+x,sy=rect.y+y;
        if(sx>=fallbackCuts[slot][sy]+(slot?1:0)&&sx<fallbackCuts[slot+1][sy]){
          const source=(sy*w+sx)*4;pixels.set(data.subarray(source,source+4),(y*rect.w+x)*4);
        }
      }
      poses.push({png:await sharp(pixels,{raw:{width:rect.w,height:rect.h,channels:4}}).png().toBuffer(),rect});
    }
  }
  return {poses,warnings};
}
// Nonstandard canvases have explicit equal-width slots. Preserve every opaque
// pixel, including disconnected weapon trails, without component-size filtering.
export async function extractSlotPoses(png:Buffer,count:number,options:{retryEdgeContact?:boolean}={}):Promise<{poses:Pose[];warnings:string[]}> {
  if(!Number.isInteger(count)||count<1||count>4)throw new Error("Invalid slot count");
  const {data,info}=await sharp(png,{limitInputPixels:24_000_000}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const poses:Pose[]=[],warnings:string[]=[];
  // A guide is advisory: the generator may shift a pose across an ideal slot
  // line. Prefer a real empty column nearby to avoid cutting a complete sword.
  const projection=new Uint32Array(info.width);
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>=128)projection[x]++;
  const cuts=[0];
  for(let slot=1;slot<count;slot++) {
    const target=Math.floor(slot*info.width/count),radius=Math.floor(info.width/count*0.3);
    let cut=target;
    for(let distance=0;distance<=radius;distance++) {
      const candidates=[target-distance,target+distance];
      const gap=candidates.find(x=>x>cuts[cuts.length-1]&&x<info.width&&projection[x]===0);
      if(gap!==undefined){cut=gap;break;}
    }
    cuts.push(cut);
  }
  cuts.push(info.width);
  for(let slot=0;slot<count;slot++) {
    const left=cuts[slot],right=cuts[slot+1];
    let x0=right,y0=info.height,x1=-1,y1=-1;
    for(let y=0;y<info.height;y++)for(let x=left;x<right;x++)if(data[(y*info.width+x)*4+3]>=128){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
    if(x1<0)throw new Error(`extract_mismatch: pose ${slot+1} is empty`);
    if(x0===left||x1===right-1||y0===0||y1===info.height-1) {
      const message=`pose ${slot+1} touches a slot edge; inspect the raw strip for possible clipping`;
      if(options.retryEdgeContact)throw new Error(`extract_mismatch: ${message}`);
      warnings.push(message);
    }
    const rect={x:x0,y:y0,w:x1-x0+1,h:y1-y0+1};
    poses.push({png:await sharp(png).extract({left:x0,top:y0,width:rect.w,height:rect.h}).png().toBuffer(),rect});
  }
  return {poses,warnings};
}
// Minimum-ink top-to-bottom seam within a slot boundary corridor. It can
// follow a gap around a prop instead of cutting an entire straight column.
function separationSeam(data:Uint8Array,width:number,height:number,lo:number,hi:number,target:number):number[] {
  const span=hi-lo+1,parents=new Int8Array(span*height);
  let previous=new Float64Array(span);
  for(let y=0;y<height;y++){
    const current=new Float64Array(span);
    for(let j=0;j<span;j++){
      const x=lo+j;let from=j,best=previous[j];
      if(j>0&&previous[j-1]+0.002<best){from=j-1;best=previous[j-1]+0.002;}
      if(j+1<span&&previous[j+1]+0.002<best){from=j+1;best=previous[j+1]+0.002;}
      current[j]=best+(data[(y*width+x)*4+3]>=128?1:0)+Math.abs(x-target)*0.0001;
      parents[y*span+j]=from-j;
    }
    previous=current;
  }
  let index=0;for(let j=1;j<span;j++)if(previous[j]<previous[index])index=j;
  const seam=Array(height).fill(0);
  for(let y=height-1;y>=0;y--){seam[y]=lo+index;index+=parents[y*span+index];}
  return seam;
}
export function buildPalette(buffers:Uint8Array[],limit=24):string[] {
  type Color={r:number;g:number;b:number;n:number};
  const histogram=new Map<number,Color>();
  for(const pixels of buffers)for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>=128){const r=pixels[i],g=pixels[i+1],b=pixels[i+2],key=(r>>3)*1024+(g>>3)*32+(b>>3);const old=histogram.get(key);if(old)old.n++;else histogram.set(key,{r,g,b,n:1});}
  let buckets=[Array.from(histogram.values())];
  if(!buckets[0].length)throw new Error("Cannot build a palette from an empty sheet");
  const range=(colors:Color[],channel:"r"|"g"|"b")=>Math.max(...colors.map(c=>c[channel]))-Math.min(...colors.map(c=>c[channel]));
  while(buckets.length<limit){
    let index=-1,spread=0;
    buckets.forEach((bucket,i)=>{const s=Math.max(range(bucket,"r"),range(bucket,"g"),range(bucket,"b"));if(bucket.length>1&&s>spread){index=i;spread=s;}});
    if(index<0)break;
    const bucket=buckets.splice(index,1)[0];const channel=(["r","g","b"] as const).reduce((a,b)=>range(bucket,a)>range(bucket,b)?a:b);
    bucket.sort((a,b)=>a[channel]-b[channel]);const total=bucket.reduce((n,c)=>n+c.n,0);let weight=0,cut=1;
    for(let i=0;i<bucket.length-1;i++){weight+=bucket[i].n;cut=i+1;if(weight>=total/2)break;}
    buckets=[...buckets,bucket.slice(0,cut),bucket.slice(cut)];
  }
  return buckets.map(bucket=>{const n=bucket.reduce((sum,c)=>sum+c.n,0);return "#"+(["r","g","b"] as const).map(k=>Math.round(bucket.reduce((sum,c)=>sum+c[k]*c.n,0)/n).toString(16).padStart(2,"0")).join("");});
}
export async function normalizePoses(poses:Pose[],palette:string[],options:{height:number;cellW:number;cellH:number;airborne?:number[];outline?:boolean;tight?:boolean}) {
  const maxW=Math.max(...poses.map(p=>p.rect.w)),maxH=Math.max(...poses.map(p=>p.rect.h));
  const scale=options.height/maxH;
  // Expand the working canvas for wide silhouettes instead of shrinking the
  // character below the design's logical resolution merely to fit a cell.
  const cellW=Math.max(options.cellW,Math.ceil(maxW*scale)+8);
  const cellH=Math.max(options.cellH,Math.ceil(maxH*scale)+16);
  const colors=palette.map(hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
  if(!colors.length)throw new Error("A locked sheet palette is required");
  const dark=colors.reduce((a,b)=>a[0]+a[1]+a[2]<b[0]+b[1]+b[2]?a:b);
  const grounded=poses.filter((_,i)=>!options.airborne?.includes(i));
  const baseline=Math.max(...(grounded.length?grounded:poses).map(p=>p.rect.y+p.rect.h));
  const output=[];
  for(let index=0;index<poses.length;index++) {
    const pose=poses[index],w=Math.max(1,Math.round(pose.rect.w*scale)),h=Math.max(1,Math.round(pose.rect.h*scale));
    const pixels=await sharp(pose.png).resize(w,h,{kernel:"nearest",fit:"fill"}).ensureAlpha().raw().toBuffer();
    let mass=0,weighted=0;
    for(let y=Math.floor(h*0.7);y<h;y++)for(let x=0;x<w;x++)if(pixels[(y*w+x)*4+3]>=128){mass++;weighted+=x;}
    const footX=mass?weighted/mass:w/2,anchorX=Math.floor(cellW/2),anchorY=cellH-8;
    const offset=options.airborne?.includes(index)?Math.max(0,Math.min(16,Math.round((baseline-pose.rect.y-pose.rect.h)*scale))):0;
    const left=Math.max(2,Math.min(cellW-w-2,Math.round(anchorX-footX))),top=Math.max(2,anchorY-h-offset);
    const cell=new Uint8Array(cellW*cellH*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const i=(y*w+x)*4;if(pixels[i+3]<128)continue;
      const best=colors.reduce((a,b)=>{const d=(c:number[])=>c.reduce((sum,v,k)=>sum+(v-pixels[i+k])**2,0);return d(a)<d(b)?a:b;});
      cell.set([...best,255],((top+y)*cellW+left+x)*4);
    }
    if(options.outline){const copy=new Uint8Array(cell);for(let y=1;y<cellH-1;y++)for(let x=1;x<cellW-1;x++){const i=(y*cellW+x)*4;if(copy[i+3])continue;if([i-4,i+4,i-cellW*4,i+cellW*4].some(j=>copy[j+3]))cell.set([...dark,255],i);}}
    let x0=0,y0=0,x1=cellW-1,y1=cellH-1;
    if(options.tight) {
      x0=cellW;y0=cellH;x1=-1;y1=-1;
      for(let y=0;y<cellH;y++)for(let x=0;x<cellW;x++)if(cell[(y*cellW+x)*4+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
      if(x1<0)throw new Error("Normalized pose is empty");
      // One logical pixel of transparent safety padding, with the original
      // pivot transformed into the cropped coordinate system. Airborne pivots
      // may lie outside the crop: the renderer still aligns them correctly.
      x0=Math.max(0,x0-1);y0=Math.max(0,y0-1);x1=Math.min(cellW-1,x1+1);y1=Math.min(cellH-1,y1+1);
    }
    const cropW=x1-x0+1,cropH=y1-y0+1;
    const png=await sharp(cell,{raw:{width:cellW,height:cellH,channels:4}}).extract({left:x0,top:y0,width:cropW,height:cropH}).png().toBuffer();
    output.push({png,w:cropW,h:cropH,anchorX:anchorX-x0,anchorY:anchorY-y0});
  }
  return output;
}

// Muse may return different physical resolutions for four- and two-frame
// batches. Rebase each batch into the same guide space before shared scaling.
export async function rescalePoseSpace(poses:Pose[],sourceHeight:number,targetHeight=320):Promise<Pose[]> {
  const scale=targetHeight/sourceHeight;
  return Promise.all(poses.map(async pose=>{
    const w=Math.max(1,Math.round(pose.rect.w*scale)),h=Math.max(1,Math.round(pose.rect.h*scale));
    return {png:await sharp(pose.png).resize(w,h,{kernel:"nearest",fit:"fill"}).png().toBuffer(),rect:{x:Math.round(pose.rect.x*scale),y:Math.round(pose.rect.y*scale),w,h}};
  }));
}
export async function composePoseSheet(frames:{png:Buffer;w:number;h:number;anchorY:number}[]) {
  const baseline=Math.max(...frames.map(frame=>frame.anchorY));
  const height=Math.max(...frames.map(frame=>baseline-frame.anchorY+frame.h));
  const width=frames.reduce((sum,frame)=>sum+frame.w,0)+(frames.length-1)*2;
  let x=0;
  const layers=frames.map(frame=>{const layer={input:frame.png,left:x,top:baseline-frame.anchorY};x+=frame.w+2;return layer;});
  return {png:await sharp({create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(layers).png().toBuffer(),width,height};
}
