import type { Manifest } from "../manifest";
export function previewViewport(manifest:Manifest,width:number,height:number) {
  let halfWidth=1,above=1,below=0;
  for(const action of Object.values(manifest.actions))for(const direction of Object.values(action.directions))for(const frame of direction.frames??[]) {
    const scale=frame.scale??1;
    halfWidth=Math.max(halfWidth,Math.abs(frame.anchorX*scale),Math.abs((frame.w-frame.anchorX)*scale));
    above=Math.max(above,frame.anchorY*scale);below=Math.max(below,(frame.h-frame.anchorY)*scale);
  }
  const zoom=Math.min(width*0.9/(halfWidth*2),height*0.88/(above+below));
  return {zoom,x:width/2,y:(height-(above+below)*zoom)/2+above*zoom};
}
