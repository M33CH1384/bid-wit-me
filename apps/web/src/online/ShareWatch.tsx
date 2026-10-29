import { useEffect, useRef, useState } from 'react';
import { watchLink } from './config';

/**
 * Share this table's watch link (streaming package): one tap — Web Share API
 * where the device has it, clipboard with a "LINK COPIED ✓" beat everywhere
 * else (the lobby's room-code share pattern). The link lands guests and
 * players alike straight in the watch view; it grants nothing but watching.
 *
 * Where spectators aren't allowed the button DOES NOT EXIST: story rooms are
 * pair-only (the server refuses everyone else at the door), so callers pass
 * `story` and get nothing. There is no host spectators-off toggle in the
 * product — the story door is the one place spectating is not allowed.
 */
export default function ShareWatchButton({ code, story = false, className = '' }: { code: string; story?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  if (story) return null;
  const share = async () => {
    const url = watchLink(code);
    const text = `Watch this Bid Wit Me table live — table ${code.toUpperCase()}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'Bid Wit Me — watch live', text, url }); return; }
      throw new Error('no native share');
    } catch {
      const payload = `${text}: ${url}`;
      let ok = false;
      try { await navigator.clipboard.writeText(payload); ok = true; } catch { /* fall through to the legacy path */ }
      if (!ok) {
        // Legacy copy: the async clipboard API refuses in unfocused documents
        // and embedded/OBS-adjacent webviews where users still expect the
        // button to work (this is the lobby room-code share's own fallback).
        try {
          const ta = document.createElement('textarea');
          ta.value = payload;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          ok = document.execCommand('copy');
          ta.remove();
        } catch { /* no copy path at all: the code on screen is the fallback */ }
      }
      if (ok) {
        setCopied(true);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1_600);
      }
    }
  };
  return (
    <button type="button" className={`share-watch-btn ${className}`} data-testid="share-watch" onClick={() => void share()}
      aria-label="Share the watch link for this table" title="Anyone with the link can watch this table live">
      🔗 {copied ? 'WATCH LINK COPIED ✓' : 'WATCH LINK'}
    </button>
  );
}
