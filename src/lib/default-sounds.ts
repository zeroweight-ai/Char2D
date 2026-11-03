// Bundled sound effects for the default moves (public/sounds/, made once with
// `npm run sounds:generate`). New characters get these for free; ElevenLabs is
// only called when the player asks for a new sound or for custom moves.
// volume evens out loudness: the jump clip is ~20 dB louder than the other two.
export type DefaultSound={url:string;prompt:string;frames:number[];durationSeconds:number;reason:string;volume:number};
export const DEFAULT_SOUNDS:Record<string,DefaultSound>={
  walk:{url:"/sounds/walk.mp3",volume:0.9,frames:[0,2],durationSeconds:0.5,reason:"A footstep on each foot contact.",
    prompt:"single soft footstep, shoe on packed dirt and short grass, one step only, short, dry, close, no reverb, 2D game sound effect"},
  jump:{url:"/sounds/jump.mp3",volume:0.3,frames:[1],durationSeconds:0.6,reason:"A light whoosh as the feet push off the ground.",
    prompt:"short light jump whoosh with a soft cloth flutter as a character pushes off the ground, quick, dry, no voice, no reverb, 2D game sound effect"},
  crouch:{url:"/sounds/crouch.mp3",volume:0.9,frames:[0],durationSeconds:0.5,reason:"A soft cloth rustle as the knees bend.",
    prompt:"quick soft cloth rustle as a character crouches down, subtle, short, dry, no voice, no reverb, 2D game sound effect"},
};
/** Moves that stay silent by default (no AI decision, no call). */
export const SILENT_DEFAULTS:Record<string,string>={idle:"Idle is a quiet breathing loop; it plays without sound."};
