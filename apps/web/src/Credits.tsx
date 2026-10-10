import { CC_BY_LINE, TRACKS } from './audio';
import { AboutRow } from './Feedback';

/** In-game credits & licenses (mirrors CREDITS.md). */
export default function Credits({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal glass slant credits" role="dialog" aria-label="Credits" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title big">CREDITS</div>
        <div className="scroll">
          <h3>Music</h3>
          <ul>
            {TRACKS.map((t) => (
              <li key={t.file}>
                <b>“{t.title}”</b> — {t.artist} · {t.license === 'CC0' ? <>CC0 (public domain) via <a href={t.source} target="_blank" rel="noreferrer">OpenGameArt</a></> : <a href={t.source} target="_blank" rel="noreferrer">incompetech.com</a>}
              </li>
            ))}
          </ul>
          <p className="cc-by">{CC_BY_LINE.split('http://')[0]}<a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">http://creativecommons.org/licenses/by/4.0/</a></p>
          <h3>Sound effects</h3>
          <p>Card &amp; chip foley from Kenney “Casino Audio” and “UI Audio” (<a href="https://kenney.nl" target="_blank" rel="noreferrer">kenney.nl</a>) — CC0. Chimes, stingers, jingles and ambience synthesized in-game.</p>
          <h3>3D art</h3>
          <p>Felt (“Scuba Suede”), rail wood (“Dark Wood”) and “Billiard Hall” HDRI from <a href="https://polyhaven.com" target="_blank" rel="noreferrer">Poly Haven</a> — CC0. Cards and table drawn procedurally.</p>
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
