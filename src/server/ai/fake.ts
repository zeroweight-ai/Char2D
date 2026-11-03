import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { hexRgb } from "../pixel/chroma";
import type { ChatModel, ImageModel, ImageRequest, ChatRequest } from "./types";
export class FakeProvider implements ChatModel, ImageModel {
  readonly caps = { referenceImages: 10, nativeTransparency: false, sizes: [[1536,1024] as [number,number]], edit: true };
  async chat(request?:ChatRequest): Promise<{text:string}> {
    if(request?.system.includes("Char2D custom action planner")) {
      const input=JSON.parse(request.messages[0].content) as {prompt:string;existing:{key:string}[]};
      let key="custom_action";let suffix=2;while(input.existing.some(action=>action.key===key))key=`custom_action_${suffix++}`;
      return {text:JSON.stringify({key,label:"Custom action",plan:{summary:input.prompt,frames:4,poses:["Anticipate: "+input.prompt,"Begin: "+input.prompt,"Perform: "+input.prompt,"Recover to neutral"],durationsMs:[100,100,150,100],playback:"once",canvas:"standard"},gameplay:{trigger:"press",lockMovement:false,interruptible:true}})};
    }
    if(request?.system.includes("Char2D walk-cycle checker"))
      return {text:JSON.stringify({legA:"near leg, drawn on top",legB:"far leg, slightly darker",distinguishable:true,frames:[{frame:1,front:"A"},{frame:2,lifted:"B"},{frame:3,front:"B"},{frame:4,lifted:"A"}]})};
    if(request?.system.includes("Char2D sound designer")) {
      const input=JSON.parse(request.messages[0].content) as {force:boolean;action:{key:string;label:string;poses:string[]}};
      const quiet=/^(idle|crouch)/.test(input.action.key);
      if(quiet&&!input.force)return {text:JSON.stringify({needed:false,reason:`${input.action.label} is a quiet motion; it plays without sound.`})};
      const walk=input.action.key==="walk";
      return {text:JSON.stringify({needed:true,reason:walk?"Footsteps on each foot contact.":`A short effect as ${input.action.label} happens.`,prompt:walk?"single soft footstep on grass":`short whoosh for ${input.action.label}`,frames:walk?[0,2]:[input.action.key==="jump"?1:0],durationSeconds:0.5})};
    }
    if(request?.system.includes("Char2D revision planner")) {
      const input=JSON.parse(request.messages[0].content) as {note:string};
      const fresh=/start (?:over|again)|from scratch|fresh (?:sheet|variation|start)|new sheet|replace (?:the )?(?:whole|entire) character/i.test(input.note);
      return {text:JSON.stringify({path:fresh ? "new_sheet":"edit_latest",reason:fresh ? "Starting fresh as requested.":"Editing the latest sheet while preserving its existing details."})};
    }
    return {text:"Fake AI is connected. No paid API request was made."};
  }
  async generate(request?:ImageRequest) {
    const count=Number(request?.prompt.match(/Frame count: (\d+)/)?.[1]??0);
    if(count) {
      const key=hexRgb(request?.prompt.match(/Background key: (#[0-9a-f]{6})/i)?.[1]??"#FF00FF");
      const w=count*40,h=64,pixels=new Uint8Array(w*h*4);
      for(let i=0;i<pixels.length;i+=4)pixels.set([...key,255],i);
      const draw=(x:number,y:number,width:number,height:number,color:number[])=>{for(let yy=y;yy<y+height;yy++)for(let xx=x;xx<x+width;xx++)pixels.set([...color,255],(yy*w+xx)*4);};
      for(let f=0;f<count;f++) {
        const x=f*40+12,bob=f%2;
        draw(x,12+bob,16,14,[25,50,110]);draw(x+2,19+bob,12,8,[255,210,161]);
        draw(x-2,27+bob,20,16,[9,191,215]);
        draw(x+f%3,43+bob,6,10-bob,[23,64,180]);draw(x+10-f%3,43+bob,6,10-bob,[23,64,180]);
      }
      return {png:await sharp(pixels,{raw:{width:w,height:h,channels:4}}).png().toBuffer(),raw:{provider:"fake",frames:count}};
    }
    const fixture=await readFile(resolve("tests/fixtures/demo-sheet.png"));
    const key=request?.prompt.match(/Background key: (#[0-9a-f]{6})/i)?.[1];
    if(!key || key.toUpperCase()==="#FF00FF") return {png:fixture,raw:{provider:"fake",fixture:"demo-sheet.png"}};
    const {data,info}=await sharp(fixture).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const rgb=hexRgb(key);
    for(let i=0;i<data.length;i+=4) if(data[i]===255 && data[i+1]===0 && data[i+2]===255) {data[i]=rgb[0];data[i+1]=rgb[1];data[i+2]=rgb[2];}
    return {png:await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer(),raw:{provider:"fake",fixture:"demo-sheet.png",key}};
  }
}
