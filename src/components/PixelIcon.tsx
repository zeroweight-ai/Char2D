// Crisp 10×10 pixel icons drawn as SVG rects in currentColor.
const ICONS = {
  upload: ["....##....", "...####...", "..######..", ".########.", "....##....", "....##....", "....##....", "#........#", "#........#", "##########"],
  quill: ["........##", ".......###", "......###.", ".....###..", "....###...", "...###....", "..###.....", ".##.......", "##........", "#........."],
  sword: ["........##", ".......#.#", "......#.#.", ".....#.#..", "#...#.#...", ".#.#.#....", "..#.#.....", "..##......", ".#..#.....", "#........."],
  star: ["....##....", "....##....", "...####...", "##########", ".########.", "..######..", "..######..", ".###..###.", ".##....##.", "#........#"],
  heart: [".##...##..", "####.####.", "#########.", "#########.", ".#######..", "..#####...", "...###....", "....#.....", "..........", ".........."],
  lock: ["...####...", "..#....#..", "..#....#..", "..#....#..", ".########.", ".###..###.", ".###..###.", ".####.###.", ".########.", ".........."],
} as const;
export type PixelIconName = keyof typeof ICONS;
export function PixelIcon({ name, className, title }: { name: PixelIconName; className?: string; title?: string }) {
  const rows = ICONS[name];
  return <svg className={className} viewBox="0 0 10 10" shapeRendering="crispEdges" fill="currentColor" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
    {rows.flatMap((row, y) => [...row].map((cell, x) => cell === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} /> : null))}
  </svg>;
}
