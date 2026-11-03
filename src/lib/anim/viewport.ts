import type { Manifest } from "../manifest";
/**
 * Fit every frame of the character into the stage. With `ground` (0–1, the
 * fraction of the stage height where a backdrop's ground surface is), the
 * shared foot baseline sits exactly on it; otherwise the character is centred.
 */
export function previewViewport(manifest:Manifest,width:number,height:number,ground?:number|null) {
  let halfWidth=1,above=1,below=0;
  for(const action of Object.values(manifest.actions))for(const direction of Object.values(action.directions))for(const frame of direction.frames??[]) {
    const scale=frame.scale??1;
    halfWidth=Math.max(halfWidth,Math.abs(frame.anchorX*scale),Math.abs((frame.w-frame.anchorX)*scale));
    above=Math.max(above,frame.anchorY*scale);below=Math.max(below,(frame.h-frame.anchorY)*scale);
  }
  if(ground){
    const y=height*ground;
    // Leave headroom above the tallest frame; anything below the feet (rare) fits under the ground line.
    const zoom=Math.min(width*0.9/(halfWidth*2),(y-height*0.06)/above,below>0?(height-y)/below:Infinity);
    return {zoom,x:width/2,y};
  }
  const zoom=Math.min(width*0.9/(halfWidth*2),height*0.88/(above+below));
  return {zoom,x:width/2,y:(height-(above+below)*zoom)/2+above*zoom};
}
