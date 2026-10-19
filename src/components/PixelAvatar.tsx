import React from 'react';

// Deterministic, colourful pixel-art client face (inline SVG, no images).
// Seed → skin / hair / shirt / background / hairstyle / glasses.
// Mood → eyes, brows, mouth.

type Mood = 'calm' | 'happy' | 'worried' | 'angry' | 'thinking';

const SKIN = ['#FFD9B3', '#F3C396', '#E8B07A', '#D29B6E', '#C68642'];
const HAIR = ['#2B2420', '#6B4226', '#1F2937', '#A9611F', '#4A3B2A', '#C94F4F', '#3B3B6B'];
const SHIRT = ['#00A3FF', '#FF6B6B', '#2ECC71', '#9B59B6', '#F39C12', '#1ABC9C', '#E84393'];
const BG: [string, string][] = [
  ['#C9ECFF', '#8FD6FF'], ['#FFE3C9', '#FFC48F'], ['#D9F7E3', '#9FE8BE'],
  ['#EADcFF', '#C9A9FF'], ['#FFE0EC', '#FFB3CE'], ['#D7F0FF', '#ADE0FF'], ['#FFF0C9', '#FFDE8F'],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function moodFromEmoji(emoji: string, difficulty?: string): Mood {
  if (/😠|😡|🤬|😤/.test(emoji)) return 'angry';
  if (/😟|😧|😨|😰|😢|😕|🙁/.test(emoji)) return 'worried';
  if (/🤔|🧐|😶/.test(emoji)) return 'thinking';
  if (/🙂|😀|😃|😄|😊/.test(emoji)) return 'happy';
  if (difficulty === 'hard') return 'angry';
  if (difficulty === 'medium') return 'worried';
  return 'calm';
}

// 12×12 grid. '.' transparent, H hair, C cap, S skin, E eye, B brow, M mouth, T shirt.
function buildGrid(mood: Mood, style: number): string[][] {
  const g: string[][] = Array.from({ length: 12 }, () => Array(12).fill('.'));
  const fill = (r0: number, r1: number, c0: number, c1: number, v: string) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (g[r]) g[r][c] = v;
  };
  // face + chin
  fill(3, 8, 3, 8, 'S'); fill(2, 2, 4, 7, 'S'); fill(9, 9, 4, 7, 'S');
  // shoulders / shirt
  fill(10, 11, 1, 10, 'T'); g[10][1] = '.'; g[10][10] = '.';
  // hair by style
  const hc = style === 2 ? 'C' : 'H';
  fill(1, 2, 3, 8, hc); fill(0, 0, 4, 7, hc); fill(2, 3, 2, 2, hc); fill(2, 3, 9, 9, hc);
  if (style === 1) { fill(3, 7, 2, 2, 'H'); fill(3, 7, 9, 9, 'H'); } // long sides
  if (style === 3) { g[0] = Array(12).fill('.'); fill(1, 1, 3, 8, '.'); } // bald-ish (just a fringe)
  if (style === 2) { fill(2, 2, 2, 9, 'C'); }                            // cap brim
  // eyes (cols 4 and 7), brows & mouth by mood
  g[5][4] = 'E'; g[5][7] = 'E';
  if (mood === 'angry') { g[4][4] = 'B'; g[4][7] = 'B'; }
  if (mood === 'thinking') { g[5][7] = 'S'; g[4][7] = 'B'; }
  if (mood === 'happy') { g[7][4] = 'M'; g[7][7] = 'M'; g[8][5] = 'M'; g[8][6] = 'M'; }
  else if (mood === 'angry' || mood === 'worried') { g[8][4] = 'M'; g[8][7] = 'M'; g[7][5] = 'M'; g[7][6] = 'M'; }
  else { g[7][4] = 'M'; g[7][5] = 'M'; g[7][6] = 'M'; g[7][7] = 'M'; }
  return g;
}

export default function PixelAvatar({ seed, mood = 'calm', size = 96, className = '' }: {
  seed: string; mood?: Mood; size?: number; className?: string;
}) {
  const h = hash(seed || 'x');
  const skin = SKIN[h % SKIN.length];
  const hair = HAIR[(h >>> 3) % HAIR.length];
  const shirt = SHIRT[(h >>> 6) % SHIRT.length];
  const [bg1, bg2] = BG[(h >>> 9) % BG.length];
  const style = (h >>> 12) % 4;
  const glasses = ((h >>> 15) & 1) === 1;
  const cap = SHIRT[(h >>> 18) % SHIRT.length];
  const grid = buildGrid(mood, style);
  const cell = 10;
  const palette: Record<string, string> = { H: hair, C: cap, S: skin, E: '#241C18', B: hair, M: '#B5495B', T: shirt };
  const gid = `g${h % 100000}`;

  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={className} shapeRendering="crispEdges" role="img" aria-label="client avatar">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={bg1} /><stop offset="100%" stopColor={bg2} />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="120" height="120" rx="20" fill={`url(#${gid})`} />
      {grid.map((row, r) => row.map((ch, c) => (ch === '.' ? null : (
        <rect key={`${r}-${c}`} x={c * cell} y={r * cell} width={cell} height={cell} fill={palette[ch] || skin} />
      ))))}
      {glasses && (
        <g fill="none" stroke="#241C18" strokeWidth="2.5">
          <rect x="36" y="48" width="16" height="12" rx="3" />
          <rect x="66" y="48" width="16" height="12" rx="3" />
          <line x1="52" y1="54" x2="66" y2="54" />
        </g>
      )}
    </svg>
  );
}
