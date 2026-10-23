/**
 * The Player Card editor (owner-approved 2026-10-23): edits the card's own
 * fields — the one-line status, up to 3 partner tags from the fixed
 * vocabulary, and up to 3 showcased badges picked from the badges the
 * player has actually EARNED (the server enforces all of it again on save;
 * this UI just makes the legal choices tappable). Opens from the card's
 * own "Edit card" button on your profile; saving returns the fresh card
 * payload, so the card re-renders as saved, immediately.
 *
 * The profile's other editors (picture, tagline, region, social links)
 * stay where they've always lived — behind the Edit profile button. The
 * card status is NOT the tagline: the tagline is the profile's longer
 * link-friendly line; the status is the card's short one (90 cap).
 */
import { useState } from 'react';
import { PARTNER_TAG_IDS, PARTNER_TAG_LABELS, badgeDisplay, badgeKeyOf, type PlayerCardData } from './PlayerCard';

export const CARD_STATUS_MAX = 90;
export const CARD_TAGS_MAX = 3;
export const CARD_SHOWCASE_MAX = 3;

const KIND_LABEL: Record<string, string> = { achievement: 'Achievements', story: 'Story badges', badge: 'Badges' };

export function CardEditor({ card, onSaved, onClose }: {
  card: PlayerCardData;
  onSaved: (card: PlayerCardData) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState(card.status ?? '');
  const [tags, setTags] = useState<string[]>(card.tags);
  const [picks, setPicks] = useState<string[]>(card.showcase.map(badgeKeyOf));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleTag = (t: string) => {
    setErr(null);
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length >= CARD_TAGS_MAX ? cur : [...cur, t]));
  };
  const togglePick = (k: string) => {
    setErr(null);
    setPicks((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : cur.length >= CARD_SHOWCASE_MAX ? cur : [...cur, k]));
  };

  const save = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await fetch('/api/profile/me/card', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, tags, showcase: picks }),
      });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; card?: PlayerCardData; error?: string };
      if (!r.ok || !j.card) throw new Error(j.error ?? `HTTP ${r.status}`);
      onSaved(j.card);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const kinds = ['achievement', 'story', 'badge'] as const;

  return (
    <div className="pcard-editor" data-testid="card-editor">
      <div className="pcard-editor-head">
        <b>Edit your card</b>
        <button type="button" className="prof-pic-btn ghost" data-testid="card-editor-close" onClick={onClose}>Done</button>
      </div>

      <label className="prof-pic-note" htmlFor="card-status-input">Status — the one-liner on your card front, in your own words.</label>
      <div className="prof-tag-edit">
        <input id="card-status-input" data-testid="card-status-input" type="text" maxLength={CARD_STATUS_MAX}
          placeholder="Say it in one line…" value={status}
          onChange={(e) => { setStatus(e.target.value); setErr(null); }} />
      </div>
      <small className="prof-tag-count">{status.length}/{CARD_STATUS_MAX} · clear it and save to remove</small>

      <span className="prof-pic-note">Partner tags — what you're here for (up to {CARD_TAGS_MAX}).</span>
      <div className="pcard-pickrow" data-testid="card-tag-picker">
        {PARTNER_TAG_IDS.map((t) => (
          <button key={t} type="button" data-testid={`card-tag-${t}`}
            className={`pcard-pick${tags.includes(t) ? ' on' : ''}`} aria-pressed={tags.includes(t)}
            onClick={() => toggleTag(t)}>
            {PARTNER_TAG_LABELS[t]}
          </button>
        ))}
      </div>

      <span className="prof-pic-note">Showcase — up to {CARD_SHOWCASE_MAX} earned badges on your card front.</span>
      {card.badges.length === 0
        ? <p className="soc-muted" data-testid="card-showcase-empty">Earn badges and achievements to showcase them here.</p>
        : kinds.map((kind) => {
          const pool = card.badges.filter((b) => b.kind === kind);
          if (!pool.length) return null;
          return (
            <div key={kind}>
              <small className="pcard-pool-label">{KIND_LABEL[kind]}</small>
              <div className="pcard-pickrow">
                {pool.map((b) => {
                  const d = badgeDisplay(b);
                  const k = badgeKeyOf(b);
                  return (
                    <button key={k} type="button" data-testid={`card-pick-${k}`}
                      className={`pcard-pick${picks.includes(k) ? ' on' : ''}`} aria-pressed={picks.includes(k)}
                      onClick={() => togglePick(k)}>
                      <span aria-hidden>{d.icon}</span> {d.name}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

      <div className="prof-link-actions">
        <button type="button" className="prof-pic-btn" data-testid="card-save" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save card'}
        </button>
        <button type="button" className="prof-pic-btn ghost" data-testid="card-cancel" disabled={busy} onClick={onClose}>Cancel</button>
        {err && <span className="prof-pic-err" role="alert">{err}</span>}
      </div>
    </div>
  );
}
