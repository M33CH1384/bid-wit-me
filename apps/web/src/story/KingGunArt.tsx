/**
 * The King's revolver, drawn as a vintage steel engraving — the Pj's Iron
 * deck's register (period iron, line work, no gore, no slogans). Used by
 * the scene player on the between-legs screen: as the King's gun beat
 * lands, the piece is set down on the table strip in front of the cast.
 * The same gun lies on the 3D felt for the whole of leg 2 (three/KingGun)
 * — this is its close read, in the scene's graphic language. Pure
 * decoration: the King's line carries the meaning, so the art is hidden
 * from assistive tech.
 */
export default function KingGunArt({ className }: { className?: string }) {
  const ink = '#ddd8ca';
  return (
    <svg className={className} viewBox="0 0 280 104" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="kg-steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b606a" />
          <stop offset="0.55" stopColor="#3a3d44" />
          <stop offset="1" stopColor="#23242a" />
        </linearGradient>
        <linearGradient id="kg-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6a4525" />
          <stop offset="1" stopColor="#38220f" />
        </linearGradient>
      </defs>
      {/* the table takes its weight: a soft shadow on the felt */}
      <ellipse cx="148" cy="98" rx="120" ry="4.5" fill="#000" opacity="0.42" />
      {/* barrel: tapered body, top rib, muzzle face, front sight */}
      <polygon points="126,30 244,32.5 244,40.5 126,41" fill="url(#kg-steel)" stroke={ink} strokeWidth="1.3" />
      <line x1="130" y1="28.4" x2="240" y2="30.7" stroke={ink} strokeWidth="1.6" />
      <path d="M142,32 L138,40 M158,32.4 L154,40.2 M174,32.8 L170,40.4 M190,33.2 L186,40.6 M206,33.6 L202,40.8 M222,34 L218,41" stroke={ink} strokeWidth="0.8" opacity="0.28" />
      <rect x="244" y="32" width="6" height="9" fill="#17181c" stroke={ink} strokeWidth="1.1" />
      <polygon points="234,30 240.5,30 237.5,23" fill="#23242a" stroke={ink} strokeWidth="1" />
      {/* underlug + ejector rod */}
      <rect x="148" y="41" width="62" height="6.5" rx="2" fill="#2c2e34" stroke={ink} strokeWidth="1.1" />
      <line x1="152" y1="45" x2="222" y2="45.8" stroke={ink} strokeWidth="0.9" opacity="0.6" />
      {/* cylinder: banded, fluted, brass centre pin */}
      <rect x="100" y="24" width="30" height="30" rx="5" fill="url(#kg-steel)" stroke={ink} strokeWidth="1.3" />
      <rect x="100" y="24" width="30" height="6" rx="3" fill="#1d1e22" stroke={ink} strokeWidth="0.9" />
      <path d="M108,31 L108,51 M115,31 L115,51 M122,31 L122,51" stroke="#000" strokeWidth="2" opacity="0.4" />
      <circle cx="115" cy="39" r="6.5" fill="none" stroke="#000" strokeWidth="0.9" opacity="0.35" />
      <circle cx="115" cy="39" r="3.2" fill="#8a6d3b" stroke={ink} strokeWidth="0.8" />
      {/* frame: top strap, recoil shield, side plate + an engraved flourish */}
      <rect x="74" y="24.5" width="30" height="5.5" fill="url(#kg-steel)" stroke={ink} strokeWidth="1.1" />
      <polygon points="74,28 100,25 100,53 80,53 74,44" fill="#33363d" stroke={ink} strokeWidth="1.2" />
      <circle cx="99" cy="39" r="11.5" fill="none" stroke={ink} strokeWidth="1.1" />
      <circle cx="87" cy="41" r="2" fill="#17181c" stroke={ink} strokeWidth="0.7" />
      <path d="M81,34 q5,-5 9.5,-0.5 q-4,4.5 -7.5,1" stroke={ink} strokeWidth="0.8" opacity="0.75" />
      {/* hammer, cocked back */}
      <polygon points="66,27 72,14 79,16.5 78,28" fill="#23242a" stroke={ink} strokeWidth="1.1" />
      <path d="M71,19 L77,20.5 M70,22.5 L76.5,24" stroke={ink} strokeWidth="0.8" opacity="0.7" />
      {/* trigger + guard */}
      <path d="M88,54 Q100,67 113,55" stroke={ink} strokeWidth="2.6" />
      <path d="M100,52 L98,60" stroke={ink} strokeWidth="2" />
      {/* walnut grip, sweeping back and down */}
      <path d="M82,50 C68,57 56,72 49,93 L71,99 C76,83 82,66 90,55 Z" fill="url(#kg-wood)" stroke={ink} strokeWidth="1.3" />
      <path d="M75,57 C65,65 58,76 53.5,88 M80,54 C71,63 64,74 59,87" stroke="#000" strokeWidth="0.9" opacity="0.35" fill="none" />
      <line x1="49" y1="93" x2="71" y2="99" stroke="#8a6d3b" strokeWidth="1.6" />
    </svg>
  );
}
