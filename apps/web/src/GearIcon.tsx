/**
 * Flat gear icon (inline SVG, currentColor) — replaces the ⚙ text emoji in the
 * top-bar / panel settings buttons. iOS renders ⚙ as a chunky metallic 3D gear
 * that clashes with the flat sibling icons (back arrow, wordmark); this draws in
 * the same single-color language and follows the button's color (incl. the
 * gold `.on` state) via currentColor. The outline is generated (8 flat-top
 * teeth around a ring with a punched centre hole) so it stays crisp at the
 * 46px tile size without a hand-typed path.
 */
const pt = (rad: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return `${(12 + rad * Math.cos(a)).toFixed(2)} ${(12 + rad * Math.sin(a)).toFixed(2)}`;
};

const TEETH = 8;
const ROOT = 7.6;
const TIP = 10.4;
let outline = '';
for (let k = 0; k < TEETH; k++) {
  const c = k * (360 / TEETH);
  outline += `${k === 0 ? 'M' : 'L'}${pt(ROOT, c - 14)} L${pt(TIP, c - 9)} L${pt(TIP, c + 9)} L${pt(ROOT, c + 14)} `;
}
const GEAR_D = `${outline}Z M12 9.1a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 1 0 0-5.8 Z`;

export default function GearIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ verticalAlign: '-0.16em', flex: 'none' }}>
      <path d={GEAR_D} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
