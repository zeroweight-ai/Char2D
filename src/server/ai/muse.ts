import "server-only";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { z } from "zod";
import { config } from "../config";
import { getDatabase } from "../db";
import { aiCalls } from "../db/schema";
import type { ChatModel, ChatRequest, ImageModel, ImageRequest } from "./types";
const chatResponse = z.object({ output: z.array(z.object({ type:z.string(), content:z.array(z.object({ type:z.string(), text:z.string().optional() })).optional() })), usage:z.unknown().optional() });
const imageResponse = z.object({ data:z.array(z.object({ b64_json:z.string().min(1) })).min(1), usage:z.unknown().optional() });
class MuseError extends Error { constructor(public status:number, message:string) { super(message); } }
export class MuseProvider implements ChatModel, ImageModel {
  // Sizes describe requested aspect ratios, not guaranteed pixel dimensions.
  readonly caps = { referenceImages:10, nativeTransparency:false, sizes:[[1536,1024] as [number,number],[1024,1024] as [number,number]], edit:true };
  private async request(path:string, body:Record<string,unknown>, kind:"chat"|"image", signal?:AbortSignal) {
    if (!config.apiKey) throw new Error("Set MUSE_API_KEY in .env.local, or enable CHAR2D_FAKE_AI=1.");
    const start = Date.now();
    const serialized = JSON.stringify(body);
    let raw: unknown;
    let failure: Error | undefined;
    try {
      for (let attempt=0; attempt<3; attempt++) {
        signal?.throwIfAborted();
        const response = await fetch(`${config.baseUrl}${path}`,{ method:"POST", headers:{ Authorization:`Bearer ${config.apiKey}`,"Content-Type":"application/json" }, body:serialized, signal:AbortSignal.any([...(signal ? [signal] : []),AbortSignal.timeout(300_000)]) });
        raw = await response.json();
        if (response.ok) return raw;
        const envelope = z.object({ error:z.object({ message:z.string().optional() }).optional() }).safeParse(raw);
        const error = new MuseError(response.status,envelope.success ? envelope.data.error?.message ?? `Muse HTTP ${response.status}` : `Muse HTTP ${response.status}`);
        if (attempt===2 || (response.status!==429 && response.status<500)) throw error;
        await new Promise<void>((resolve,reject) => {
          const cleanup = () => signal?.removeEventListener("abort",abort);
          const timer = setTimeout(() => { cleanup(); resolve(); },500*2**attempt+Math.random()*250);
          const abort = () => { clearTimeout(timer); cleanup(); reject(signal?.reason); };
          signal?.addEventListener("abort",abort,{once:true});
        });
      }
      throw new Error("Muse request exhausted attempts");
    } catch (error) { failure=error instanceof Error ? error : new Error("Muse request failed"); throw failure; }
    finally {
      const usage = z.object({ usage:z.unknown().optional() }).safeParse(raw);
      getDatabase().db.insert(aiCalls).values({ id:nanoid(),kind,model:String(body.model),requestHash:createHash("sha256").update(serialized).digest("hex"),latencyMs:Date.now()-start,usageJson:JSON.stringify(usage.success ? usage.data.usage ?? null : null),ok:!failure,error:failure?.message,createdAt:Date.now() }).run();
    }
  }
  async chat(request:ChatRequest) {
    const raw = await this.request("/responses",{ model:config.chatModel,store:false,instructions:request.system,input:request.messages.map(message => ({ role:message.role,content:[{type:message.role==="assistant" ? "output_text":"input_text",text:message.content}] })) },"chat",request.signal);
    const parsed = chatResponse.parse(raw);
    return { text:parsed.output.filter(item => item.type==="message").flatMap(item => item.content ?? []).filter(block => block.type==="output_text").map(block => block.text ?? "").join(""), usage:parsed.usage };
  }
  async generate(request:ImageRequest) {
    if (request.seed!==undefined) throw new Error("Muse Image does not support seed.");
    if (request.transparent) throw new Error("Muse Image returns opaque images. Use a chroma-key background.");
    if ((request.references?.length ?? 0)>10) throw new Error("Muse accepts at most 10 reference images.");
    const refs = request.references ?? [];
    const raw = await this.request(refs.length ? "/images/edits":"/images/generations",{
      model:config.imageModel,prompt:request.prompt,n:1,size:`${request.size[0]}x${request.size[1]}`,output_format:"png",response_format:"b64_json",
      ...(refs.length ? { images:refs.map(bytes => ({ image_url:`data:image/png;base64,${bytes.toString("base64")}` })) }:{}),
    },"image",request.signal);
    const parsed = imageResponse.parse(raw);
    return { png:Buffer.from(parsed.data[0].b64_json,"base64"),raw,usage:parsed.usage };
  }
}
