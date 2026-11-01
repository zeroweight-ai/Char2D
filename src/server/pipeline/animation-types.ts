import { z } from "zod";
import { directionSchema } from "@/lib/manifest";
export const frameRefSchema=z.object({assetId:z.string(),w:z.number().int().positive(),h:z.number().int().positive(),anchorX:z.number(),anchorY:z.number(),scale:z.number().positive().optional(),durationMs:z.number().int().positive()});
export const framesSchema=z.partialRecord(directionSchema,z.array(frameRefSchema));
export const stripRefSchema=z.object({rawAssetId:z.string(),responseAssetId:z.string().optional(),frames:z.number().int().positive().optional(),segment:z.number().int(),prompt:z.string(),invalid:z.boolean().optional()});
export const stripsSchema=z.partialRecord(directionSchema,z.array(stripRefSchema));
export const animationPayloadSchema=z.object({sheetId:z.string(),idleVersionId:z.string().optional(),rawOnly:z.boolean().optional(),stage:z.enum(["prepare","finish"]).optional(),versionId:z.string().optional(),direction:directionSchema.optional(),versionIds:z.array(z.string()).optional()});
export type FrameRef=z.infer<typeof frameRefSchema>;
