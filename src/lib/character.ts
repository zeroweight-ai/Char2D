import { type Manifest, type ActionGameplay } from "./manifest";
import type { Bindings } from "./bindings";
import { z } from "zod";
export const DEFAULT_CHARACTER_HEIGHT=128;
export const createCharacterSchema = z.object({
  logicalHeight:z.literal(DEFAULT_CHARACTER_HEIGHT).default(DEFAULT_CHARACTER_HEIGHT),
  mode: z.enum(["upload", "prompt"]),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000).default(""),
}).superRefine((value, ctx) => {
  if (value.mode === "prompt" && !value.description) ctx.addIssue({code:"custom",path:["description"],message:"Describe the character you want to create."});
});
export const styleSchema = z.object({chromaKey:z.string().regex(/^#[0-9A-F]{6}$/i),colorSamples:z.array(z.tuple([z.number().min(0).max(255),z.number().min(0).max(255),z.number().min(0).max(255)])).max(4096).optional(),logicalHeight:z.union([z.literal(48),z.literal(64),z.literal(DEFAULT_CHARACTER_HEIGHT)]).default(DEFAULT_CHARACTER_HEIGHT),paletteSize:z.literal(24).default(24),outline:z.boolean().default(false),mirrorLeft:z.boolean().default(true)});
export type CharacterDetail = {
  id:string; name:string; description:string; status:string;
  manifest?:Manifest|null;
  animation?:{total:number;done:number;running:number;error:string|null;warnings:string[];actions:CharacterAction[]}|null;
  bindings?:Bindings;
  soundAvailable?:boolean;
  sourceAssetId:string|null;
  sheet: {fullResolution?:boolean;warnings?:string[];id:string; status:string; rawAssetId:string|null; processedAssetId:string|null; version:number}|null;
  job: {id:string; status:string; error:string|null;revision?:{path:"edit_latest"|"new_sheet";reason:string}|null}|null;
};
export type ActionVersionSummary={id:string;version:number;status:string;createdBy:string;createdAt:number};
export type ActionSound={status:"undecided"|"none"|"queued"|"generating"|"ready"|"error";reason:string|null;prompt:string|null;url:string|null;frames:number[];error:string|null;requestedBy:"ai"|"user"|"default"|null};
export type CharacterAction={sound?:ActionSound;key:string;label:string;imageCalls?:number;nativeResolution?:boolean;status:string;version:number;error:string|null;activeVersionId?:string|null;activeVersion?:number|null;versions?:ActionVersionSummary[];gameplay?:ActionGameplay};
