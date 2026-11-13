/**
 * The matchup page that sits under the versus stage (matchupPredictor.ts): a headline card, the
 * MATCHUP PREDICTOR ring with each side's share, and a title for the players section. Our own
 * colours and type; the numbers are only the ones the game really has.
 */
import { predictionCaption, type MatchupPrediction } from './matchupPredictor';
import './versusPreview.css';

/** Ring colours by side: the viewer's gold first, then the app's violet, blue and rose. */
export const PREDICTOR_COLORS = ['var(--gold)', 'var(--purple-hot)', 'rgb(var(--cyan-rgb))', 'var(--red)'] as const;

const R = 42;
const C = 2 * Math.PI * R;

export function PredictorRing({ pct }: { pct: number[] }) {
  let at = 0;
  return (
    <svg className="vp-ring" viewBox="0 0 100 100" role="img" aria-label={`Win chance ${pct.map((p) => `${p}%`).join(' to ')}`}>
      <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="11" />
      {pct.map((p, i) => {
        const len = (p / 100) * C;
        // a hair of gap between segments so each side reads as its own arc
        const el = <circle key={i} cx="50" cy="50" r={R} fill="none" stroke={PREDICTOR_COLORS[i % PREDICTOR_COLORS.length]} strokeWidth="11" strokeDasharray={`${Math.max(0, len - 1.2)} ${C}`} strokeDashoffset={-at} transform="rotate(-90 50 50)" />;
        at += len;
        return el;
      })}
      <line x1="50" y1="30" x2="50" y2="70" stroke="rgba(255,255,255,.35)" strokeWidth=".8" strokeDasharray="1.6 1.6" />
    </svg>
  );
}

export function VersusPreview({ title, sub, labels, prediction }: {
  title: string;
  sub: string | null;
  labels: string[];
  prediction: MatchupPrediction | null;
}) {
  const two = !!prediction && prediction.pct.length === 2;
  return (
    <div className="versus-preview" data-testid="versus-preview">
      <div className="vp-card vp-story" data-testid="versus-preview-story">
        <strong>{title}</strong>
        {sub && <span>— {sub}</span>}
      </div>
      {prediction && (
        <div className="vp-card vp-predictor" data-testid="versus-predictor" data-basis={prediction.basis}>
          <div className="vp-title">MATCHUP PREDICTOR</div>
          {two ? (
            <div className="vp-two">
              <div className="vp-share left"><b>{prediction.pct[0]}%</b><span><i style={{ background: PREDICTOR_COLORS[0] }} />{labels[0]}</span></div>
              <PredictorRing pct={prediction.pct} />
              <div className="vp-share right"><b>{prediction.pct[1]}%</b><span>{labels[1]}<i style={{ background: PREDICTOR_COLORS[1] }} /></span></div>
            </div>
          ) : (
            <div className="vp-many">
              <PredictorRing pct={prediction.pct} />
              <ul>{prediction.pct.map((p, i) => <li key={i}><i style={{ background: PREDICTOR_COLORS[i % PREDICTOR_COLORS.length] }} /><span>{labels[i]}</span><b>{p}%</b></li>)}</ul>
            </div>
          )}
          <p className="vp-caption">{predictionCaption(prediction)}</p>
        </div>
      )}
    </div>
  );
}
