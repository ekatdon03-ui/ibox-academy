import React from 'react';

// Deterministic pixel-art client face rendered as inline SVG (no images).
// Mood drives the eyes/brows/mouth; seed drives skin & hair colour.

type Mood = 'calm' | 'happy' | 'worried' | 'angry' | 'thinking';

const SKIN = ['#F2C9A0', '#E8B98A', '#D9A066', '#C68642', '#FADcB5'];
const HAIR = ['#2B2420', '#6B4A2B', '#1F2937', '#8B5E34', '#4A3B2A', '#B5651D'];
const SHIRT = ['#00A3FF', '#002D57', '#2E8B57', '#C0392B', '#6C5CE7', '#E67E22'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
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

// 10×10 grid. '.' transparent, 'H' hair, 'S' skin, 'E' eye, 'B' brow, 'M' mouth, 'T' shirt.
function buildGrid(mood: Mood): string[] {
  const g: string[][] = [
    '..HHHHHH..'.split(''),
    '.HHHHHHHH.'.split(''),
    'HHHHHHHHHH'.split(''),
    'HHSSSSSSHH'.split(''),
    'HSSSSSSSSH'.split(''),
    '.SSSSSSSS.'.split(''),
    '.SSSSSSSS.'.split(''),
    '.SSSSSSSS.'.split(''),
    '..SSSSSS..'.split(''),
    '.TTTTTTTT.'.split(''),
  ];
  const set = (r: number, c: number, v: string) => { if (g[r] && g[r][c] !== undefined && g[r][c] !== '.') g[r][c] = v; };
  // eyes on row 5, columns 2 and 7
  set(5, 2, 'E'); set(5, 7, 'E');
  if (mood === 'angry') { set(4, 2, 'B'); set(4, 3, 'B'); set(4, 6, 'B'); set(4, 7, 'B'); }
  if (mood === 'thinking') { g[5][7] = 'S'; set(4, 6, 'B'); set(4, 7, 'B'); } // one eye squint + brow
  // mouth
  if (mood === 'happy') { set(7, 3, 'M'); set(7, 6, 'M'); set(8, 4, 'M'); set(8, 5, 'M'); }
  else if (mood === 'angry' || mood === 'worried') { set(8, 3, 'M'); set(8, 6, 'M'); set(7, 4, 'M'); set(7, 5, 'M'); }
  else { set(7, 3, 'M'); set(7, 4, 'M'); set(7, 5, 'M'); set(7, 6, 'M'); } // flat
  return g.map((row) => row.join(''));
}

export default function PixelAvatar({ seed, mood = 'calm', size = 96, className = '' }: {
  seed: string; mood?: Mood; size?: number; className?: string;
}) {
  const h = hash(seed || 'x');
  const skin = SKIN[h % SKIN.length];
  const hair = HAIR[(h >> 3) % HAIR.length];
  const shirt = SHIRT[(h >> 6) % SHIRT.length];
  const grid = buildGrid(mood);
  const cell = 10; // viewBox units per pixel
  const palette: Record<string, string> = { H: hair, S: skin, E: '#2B2420', B: hair, M: '#9B3B3B', T: shirt };

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} shapeRendering="crispEdges" role="img" aria-label="client avatar">
      <rect x="0" y="0" width="100" height="100" rx="14" fill="#F5F7FA" />
      {grid.map((row, r) =>
        row.split('').map((ch, c) => (ch === '.' ? null : (
          <rect key={`${r}-${c}`} x={c * cell} y={r * cell} width={cell} height={cell} fill={palette[ch] || skin} />
        )))
      )}
    </svg>
  );
}
