export function frameAtTime(durationsMs: readonly number[], elapsedMs: number, playback: "loop" | "once" | "once_hold") {
  if (!durationsMs.length || durationsMs.some(ms => !Number.isFinite(ms) || ms<=0) || !Number.isFinite(elapsedMs)) throw new Error("Expected finite positive durations and finite elapsed time");
  const total=durationsMs.reduce((sum,ms) => sum+ms,0);
  const elapsed=Math.max(0,elapsedMs);
  const finished=playback!=="loop" && elapsed>=total;
  let time=playback==="loop" ? elapsed%total : Math.min(elapsed,total-Number.EPSILON);
  for(let index=0;index<durationsMs.length;index++) {
    if(time<durationsMs[index])return {index,finished};
    time-=durationsMs[index];
  }
  return {index:durationsMs.length-1,finished};
}
