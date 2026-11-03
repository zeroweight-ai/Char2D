// images: labelled PNGs shown to the model after `content` (user messages only).
export type ChatMessage = { role: "user" | "assistant"; content: string; images?: { label: string; png: Buffer }[] };
export type ChatRequest = { system: string; messages: ChatMessage[]; signal?: AbortSignal };
export type ChatResult = { text: string; usage?: unknown };
export interface ChatModel { chat(request: ChatRequest): Promise<ChatResult> }
export type ImageRequest = { prompt: string; references?: Buffer[]; size: [number, number]; transparent?: boolean; seed?: number; signal?: AbortSignal };
export interface ImageModel {
  readonly caps: { referenceImages: number; nativeTransparency: boolean; sizes: Array<[number, number]>; edit: boolean };
  generate(request: ImageRequest): Promise<{ png: Buffer; raw: unknown; usage?: unknown }>;
}
