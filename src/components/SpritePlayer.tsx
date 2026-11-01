"use client";
import { useEffect,useRef,useState } from "react";
import type { Direction,Manifest } from "@/lib/manifest";
import { previewViewport } from "@/lib/anim/viewport";
export function SpritePlayer({manifest,action,direction,frame,flip=false,zoom="fit"}:{manifest:Manifest;action:string;direction:Direction;frame:number;flip?:boolean;zoom?:"fit"|"native"}) {
  const host=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null);
  const [size,setSize]=useState({width:512,height:384,dpr:1});
  const [atlas,setAtlas]=useState<HTMLImageElement|null>(null),[error,setError]=useState(false);
  useEffect(()=>{
    const update=()=>{const width=Math.max(1,host.current?.clientWidth??512);setSize({width,height:Math.min(600,Math.max(320,width*0.65)),dpr:window.devicePixelRatio||1});};
    update();const observer=new ResizeObserver(update);if(host.current)observer.observe(host.current);window.addEventListener("resize",update);
    return ()=>{observer.disconnect();window.removeEventListener("resize",update);};
  },[]);
  useEffect(()=>{
    let cancelled=false;const image=new window.Image();setAtlas(null);setError(false);
    image.onload=()=>{if(!cancelled)setAtlas(image);};image.onerror=()=>{if(!cancelled)setError(true);};image.src=manifest.atlas.url;
    return ()=>{cancelled=true;};
  },[manifest.atlas.url]);
  const selection=manifest.actions[action]?.directions[direction];
  const frames=selection?.mirrorOf?manifest.actions[action].directions[selection.mirrorOf]?.frames:selection?.frames;
  const rect=frames?.[Math.min(frame,frames.length-1)];
  const viewport=previewViewport(manifest,size.width,size.height);
  const renderScale=zoom==="native"?1:viewport.zoom*(rect?.scale??1);
  const cssWidth=zoom==="native"?Math.max(size.width,(rect?.w??0)+32):size.width;
  const cssHeight=zoom==="native"?Math.max(size.height,(rect?.h??0)+32):size.height;
  useEffect(()=>{
    const element=canvas.current,context=element?.getContext("2d");if(!element||!context)return;
    const width=Math.ceil(cssWidth*size.dpr),height=Math.ceil(cssHeight*size.dpr);
    if(element.width!==width)element.width=width;if(element.height!==height)element.height=height;
    context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,width,height);if(!atlas||!rect)return;
    const mirrored=!!selection?.mirrorOf!==flip;
    const x=zoom==="native"?(cssWidth-rect.w)/2+(mirrored?rect.w-rect.anchorX:rect.anchorX):viewport.x;
    const y=zoom==="native"?(cssHeight-rect.h)/2+rect.anchorY:viewport.y;
    context.setTransform(size.dpr,0,0,size.dpr,0,0);
    context.imageSmoothingEnabled=renderScale<1;context.imageSmoothingQuality="high";
    context.translate(x,y);context.scale(mirrored?-renderScale:renderScale,renderScale);
    context.drawImage(atlas,rect.x,rect.y,rect.w,rect.h,-rect.anchorX,-rect.anchorY,rect.w,rect.h);
  },[atlas,rect,selection,flip,size.dpr,cssWidth,cssHeight,zoom,viewport.x,viewport.y,renderScale]);
  return <div ref={host} style={{width:"100%",height:size.height,overflow:"auto"}}>{error&&<p role="alert" className="error">Could not load the animation atlas. Refresh to try again.</p>}<canvas ref={canvas} style={{width:cssWidth,height:cssHeight,maxWidth:"none",display:"block",imageRendering:renderScale<1?"auto":"pixelated"}} role="img" aria-label={`${action} animation facing ${direction}`} data-action={action} data-direction={direction} data-frame={frame} data-render-scale={renderScale} data-zoom={zoom} data-testid="sprite-player"/></div>;
}
