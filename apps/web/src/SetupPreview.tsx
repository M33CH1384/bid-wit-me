import type { CSSProperties } from 'react';
import { deckBackUrl, deckName, deckThumbUrl } from './decks';
import { VENUE_DEFS, type VenueChoice } from './venues';

/**
 * S2 live venue/deck preview (boards/HANDOFF.md, Bots setup --land-tab:
 * "a live venue/deck preview … Replace the current empty green rectangle").
 * A light, flat stand-in for the table — the venue's own backdrop (the
 * existing /assets/venues/<id>/bg.jpg) behind a CSS felt in the venue's
 * felt/rail colours, with the chosen deck's K♠ face and back on it.
 * No three.js and no new art: it reads VENUE_DEFS + the deck URL helpers only.
 * Two hosts, one component: the bots setup (direct child of .ess-barred —
 * hidden at phone sizes, display:none so the backdrop never downloads;
 * shown as the tall panel in the tablet/desktop landscape layout and as a
 * compact horizontal strip on portrait tablets, W3 Finding H, responsive
 * audit 2026-11-05) and the online create form (inside its Deck & venue
 * card, where card-scoped CSS in styles.css turns it on).
 * It updates live as the deck/venue change on either host.
 */
export function SetupPreview({ deck, venue }: { deck: string; venue: VenueChoice }) {
  const v = venue === 'random' ? null : VENUE_DEFS[venue];
  const style = {
    '--sp-felt': (v ?? VENUE_DEFS.classic).felt,
    '--sp-rail': (v ?? VENUE_DEFS.classic).railTint,
    '--sp-bg': v && v.id !== 'classic' ? `url(/assets/venues/${v.id}/bg.jpg)` : 'none',
  } as CSSProperties;
  const label = v ? v.name : 'Random venue';
  return (
    <figure className="setup-preview" data-testid="setup-preview" data-venue={venue} data-deck={deck} style={style} aria-label={`Preview: ${label}, ${deckName(deck)} deck`}>
      <div className="sp-stage" aria-hidden>
        <div className="sp-table">
          <img className="sp-card back l" src={deckBackUrl(deck)} alt="" loading="lazy" decoding="async" />
          <img className="sp-card face" src={deckThumbUrl(deck)} alt="" loading="lazy" decoding="async" />
          <img className="sp-card back r" src={deckBackUrl(deck)} alt="" loading="lazy" decoding="async" />
        </div>
      </div>
      <figcaption><small>Preview</small><b>{label} · {deckName(deck)} deck</b></figcaption>
    </figure>
  );
}
