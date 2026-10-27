import { type ReactNode } from 'react';
import { useEscapeClose } from './useEscapeClose';
import { TRACKS } from './audio';

/** Text with its URLs turned into links. */
function Linked({ text }: { text: string }) {
  const parts: ReactNode[] = text.split(/(https?:\/\/[^\s|,]+)/g).map((x, i) => (/^https?:\/\//.test(x) ? <a key={i} href={x} target="_blank" rel="noreferrer">{x}</a> : x));
  return <>{parts}</>;
}
import { AboutRow } from './Feedback';

/** In-game credits & licenses (mirrors CREDITS.md). */
export default function Credits({ onClose }: { onClose: () => void }) {
  const esc = useEscapeClose(onClose);
  return (
    <div className="modal-backdrop" ref={esc} onClick={onClose}>
      <div className="modal glass slant credits" role="dialog" aria-label="Credits" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title big">CREDITS</div>
        <div className="scroll">
          <h3>Music</h3>
          <ul className="music-credits">
            {TRACKS.map((t) => (
              <li key={t.file}>
                <b>“{t.title}”</b> — {t.artist} · {t.license === 'Original' ? <>Original score, composed &amp; produced for Bid Wit Me</> : t.license === 'CC0' ? <>CC0 (public domain) via <a href={t.source} target="_blank" rel="noreferrer">OpenGameArt</a> · Music by {t.artist}</> : <a href={t.source} target="_blank" rel="noreferrer">{t.license}</a>}
                {t.credit && <p className="cc-by"><Linked text={t.credit} /></p>}
              </li>
            ))}
          </ul>
          <h3>Bot voices</h3>
          <p data-testid="voice-credits">Bot voices: generated with Kokoro-82M by hexgrad (Apache-2.0), <a href="https://huggingface.co/hexgrad/Kokoro-82M" target="_blank" rel="noreferrer">https://huggingface.co/hexgrad/Kokoro-82M</a></p>
          <h3>Sound effects</h3>
          <p>Card &amp; chip foley from Kenney “Casino Audio” and “UI Audio” (<a href="https://kenney.nl" target="_blank" rel="noreferrer">kenney.nl</a>) — CC0. The RIP-sheet police wail is “Whelen Wail” by Jefflix (<a href="https://freesound.org/people/Jefflix/sounds/157867/" target="_blank" rel="noreferrer">Freesound</a>) — CC0. The spray-paint transition is real cans, recorded: the shake is “Spray Paint Can Shaking” by Beenjamone (<a href="https://freesound.org/people/Beenjamone/sounds/548623/" target="_blank" rel="noreferrer">Freesound</a>) — CC0, and the hiss is cut from “Spray Can Sound Effects (Shaking, Spraying)” by BorzSounds (<a href="https://freesound.org/people/BorzSounds/sounds/842753/" target="_blank" rel="noreferrer">Freesound</a>) — CC0. Chimes, stingers, jingles and ambience synthesized in-game.</p>
          <h3>3D art</h3>
          <p>Felt (“Scuba Suede”), rail wood (“Dark Wood”) and “Billiard Hall” HDRI from <a href="https://polyhaven.com" target="_blank" rel="noreferrer">Poly Haven</a> — CC0. Venue backdrops and lighting (HDRIs “Qwantani Dusk 2”, “Royal Esplanade”, “Phone Shop”, “Abandoned Factory Canteen 01”, “Shanghai Bund”, “Fireplace”, “Colorful Studio”, “Umhlanga Sunrise”, “Brown Photostudio 02”, “Venice Sunset”) and floor / rail textures also from Poly Haven — CC0. Cards, table and venue props drawn procedurally.</p>
          <h3>Fonts &amp; code</h3>
          <p>Barlow Condensed (SIL OFL 1.1). three.js, React Three Fiber, drei, React, Vite (MIT).</p>
          <p className="muted">Bid Wit Me name and BWM logo © Bid Wit Me.</p>
          <h3>Version</h3>
          <AboutRow />
        </div>
        <button type="button" className="primary big" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
