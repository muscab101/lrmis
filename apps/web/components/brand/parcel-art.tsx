/**
 * Hand-drawn cadastral sketch: irregular plots along streets, one surveyed parcel
 * highlighted with its PUN. Decorative only.
 */
const PLOTS = [
  "M40 60 L150 48 L160 140 L52 152 Z",
  "M150 48 L262 40 L270 128 L160 140 Z",
  "M262 40 L380 34 L386 120 L270 128 Z",
  "M52 172 L162 160 L170 262 L60 270 Z",
  "M182 158 L276 150 L284 250 L190 258 Z",
  "M276 150 L388 140 L396 240 L284 250 Z",
  "M60 290 L172 282 L178 372 L68 380 Z",
  "M190 278 L292 270 L300 362 L196 370 Z",
  "M292 270 L398 262 L404 352 L300 362 Z",
  "M68 400 L180 392 L186 470 L74 476 Z",
  "M200 390 L306 382 L312 462 L206 468 Z",
  "M306 382 L410 372 L416 454 L312 462 Z",
];

export function ParcelArt({ pun, className }: { pun: string; className?: string }) {
  return (
    <svg viewBox="0 0 460 520" className={className} aria-hidden>
      {/* streets */}
      <path d="M20 160 C 160 150, 300 140, 440 128" stroke="currentColor" strokeOpacity="0.18" strokeWidth="10" fill="none" strokeLinecap="round" />
      <path d="M24 280 C 170 270, 300 262, 444 250" stroke="currentColor" strokeOpacity="0.18" strokeWidth="10" fill="none" strokeLinecap="round" />
      <path d="M172 20 C 176 180, 184 340, 192 500" stroke="currentColor" strokeOpacity="0.14" strokeWidth="8" fill="none" strokeLinecap="round" />
      {PLOTS.map((d, i) => (
        <path key={i} d={d} fill="currentColor" fillOpacity={i % 3 === 0 ? 0.06 : 0.03} stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" />
      ))}
      {/* surveyed parcel */}
      <path d="M182 158 L276 150 L284 250 L190 258 Z" fill="var(--flag)" fillOpacity="0.28" stroke="var(--flag)" strokeWidth="2" />
      {[
        [182, 158],
        [276, 150],
        [284, 250],
        [190, 258],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="4" fill="var(--ink)" stroke="var(--flag)" strokeWidth="2" />
      ))}
      <text x="198" y="180" fill="currentColor" fillOpacity="0.55" fontSize="10" fontFamily="var(--font-jetbrains), monospace">
        412 m²
      </text>
      {/* label */}
      <g transform="translate(250 286)">
        <line x1="-16" y1="-30" x2="0" y2="0" stroke="var(--flag)" strokeWidth="1.5" />
        <rect x="0" y="-2" width="156" height="30" rx="3" fill="var(--flag)" />
        <text x="10" y="17" fill="white" fontSize="12" fontWeight="600" fontFamily="var(--font-jetbrains), monospace">
          {pun}
        </text>
      </g>
      {/* north arrow */}
      <g transform="translate(418 470)" fill="currentColor" fillOpacity="0.55">
        <path d="M0 -18 L7 6 L0 1 L-7 6 Z" />
        <text x="-4" y="22" fontSize="11" fontWeight="600">
          N
        </text>
      </g>
    </svg>
  );
}
