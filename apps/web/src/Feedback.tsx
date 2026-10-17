import { useMemo, useRef, useState } from 'react';
import { useEscapeClose } from './useEscapeClose';
import { serverUrl } from './online/config';
import { describeContext, feedbackContext, shrinkImage, snapScreen } from './feedbackContext';
import { TIP_LABEL, TIP_NOTE, TIP_URL, openTip } from './support';
import { versionLine } from './version';

const TYPES = [['bug', 'Bug'], ['idea', 'Mode idea'], ['other', 'Other']] as const;
const MAX_SHOTS = 3;

/** "Send feedback" sheet: type, message, optional name / reply email, up to 3 screenshots (+ "Snap this screen"). */
export default function Feedback({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState<(typeof TYPES)[number][0]>('bug');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [shots, setShots] = useState<string[]>([]);
  const [busy, setBusy] = useState<'' | 'snap' | 'pick' | 'send'>('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [showCtx, setShowCtx] = useState(false);
  const ctx = useMemo(() => feedbackContext(), []);
  const file = useRef<HTMLInputElement>(null);
  const room = MAX_SHOTS - shots.length;

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy('pick'); setError('');
    try {
      const list = [...files].filter((f) => f.type.startsWith('image/')).slice(0, room);
      const out: string[] = [];
      for (const f of list) out.push(await shrinkImage(f));
      setShots((s) => [...s, ...out].slice(0, MAX_SHOTS));
    } catch { setError("Couldn't read that image. Try a PNG or JPEG."); }
    setBusy('');
    if (file.current) file.current.value = '';
  };
  const snap = async () => {
    setBusy('snap'); setError('');
    try { const s = await snapScreen(); if (s) setShots((xs) => [...xs, s].slice(0, MAX_SHOTS)); } catch { setError("Couldn't capture the screen here. You can attach a screenshot instead."); }
    setBusy('');
  };
  const send = async () => {
    if (message.trim().length < 3) { setError('Tell us a little more (a few words is fine).'); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("That email doesn't look right (or leave it empty)."); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setError("You're offline. Feedback needs an internet connection: try again when you're back online."); return; }
    setBusy('send'); setError('');
    try {
      const r = await fetch(`${serverUrl()}/api/feedback`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, message: message.trim(), name: name.trim(), email: email.trim(), website, context: ctx, shots }),
      });
      if (r.ok) setDone(true);
      else {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setError(r.status === 429 ? (j.error ?? 'Too many messages: try again in an hour.') : `Couldn't send that (${j.error ?? r.status}).`);
      }
    } catch { setError("Couldn't reach the Bid Wit Me server. Check your connection and try again."); }
    setBusy('');
  };

  const esc = useEscapeClose(onClose);
  return (
    <div className="modal-backdrop sheet-backdrop" ref={esc} onClick={onClose} data-feedback-ui>
      <div className="sheet glass slant feedback" role="dialog" aria-label="Send feedback" data-testid="feedback" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <span className="panel-title">SEND FEEDBACK</span>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </header>
        {done ? (
          <div className="sheet-body fb-done" data-testid="feedback-done">
            <div className="fb-thanks">♥</div>
            <p><b>Thank you!</b> We read every message. {email ? "If we have questions, we'll email you." : ''}</p>
            <button type="button" className="primary" onClick={onClose}>Back to the game</button>
          </div>
        ) : (
          <div className="scroll sheet-body">
            <div className="seg fb-type" role="radiogroup" aria-label="Feedback type">
              {TYPES.map(([k, l]) => <button key={k} type="button" role="radio" aria-label={l} aria-checked={type === k} className={type === k ? 'on' : ''} onClick={() => setType(k)}>{l}</button>)}
            </div>
            <label className="fb-field">
              <span>{type === 'bug' ? 'What happened? What did you expect?' : type === 'idea' ? 'Your idea for a mode or house rule' : 'Your message'}</span>
              <textarea data-testid="fb-message" rows={4} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={type === 'bug' ? 'e.g. On my iPhone the bid buttons were cut off after…' : ''} />
            </label>
            <div className="fb-row">
              <label className="fb-field"><span>Name / handle <i>(optional)</i></span><input maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" /></label>
              <label className="fb-field"><span>Email for a reply <i>(optional)</i></span><input type="email" maxLength={120} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
            </div>
            {/* honeypot: hidden from people, tempting for bots */}
            <label className="fb-hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" /></label>
            <div className="fb-shots">
              <span className="fb-label">Screenshots <i>({shots.length}/{MAX_SHOTS})</i></span>
              <div className="fb-thumbs">
                {shots.map((s, i) => (
                  <span key={i} className="fb-thumb"><img src={s} alt={`screenshot ${i + 1}`} /><button type="button" aria-label={`Remove screenshot ${i + 1}`} onClick={() => setShots(shots.filter((_, j) => j !== i))}>✕</button></span>
                ))}
              </div>
              <div className="fb-shot-btns">
                <button type="button" data-testid="fb-snap" disabled={room <= 0 || !!busy} onClick={snap}>{busy === 'snap' ? 'Snapping…' : '📸 Snap this screen'}</button>
                <button type="button" disabled={room <= 0 || !!busy} onClick={() => file.current?.click()}>{busy === 'pick' ? 'Adding…' : '🖼 Add image'}</button>
                <input ref={file} type="file" accept="image/*" multiple hidden data-testid="fb-file" onChange={(e) => addFiles(e.target.files)} />
              </div>
            </div>
            <button type="button" className="link fb-ctx-toggle" aria-expanded={showCtx} onClick={() => setShowCtx(!showCtx)}>{showCtx ? '▾' : '▸'} What's included automatically</button>
            {showCtx && <ul className="fb-ctx" data-testid="fb-context">{describeContext(ctx).map((l) => <li key={l}>{l}</li>)}</ul>}
            {error && <p className="fb-error" role="alert" data-testid="fb-error">{error}</p>}
            <button type="button" className="primary big fb-send" data-testid="fb-send" disabled={!!busy} onClick={send}>{busy === 'send' ? 'Sending…' : 'Send feedback'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Version line + "Send feedback" + tip jar, for More options and Credits. */
export function AboutRow({ onFeedback }: { onFeedback?: () => void }) {
  return (
    <div className="about-row">
      <span className="version" data-testid="version">{versionLine()}</span>
      <div className="about-btns">
        {onFeedback && <button type="button" data-testid="open-feedback" onClick={onFeedback}>✉ Send feedback</button>}
        {TIP_URL && <TipButton />}
      </div>
      {TIP_URL && <p className="tip-note">{TIP_NOTE}</p>}
    </div>
  );
}

export function TipButton() {
  if (!TIP_URL) return null;
  return <button type="button" className="tip-btn" data-testid="tip-btn" aria-label={`${TIP_LABEL}: opens in a new tab`} onClick={openTip}><span aria-hidden>♥</span> {TIP_LABEL}</button>;
}
