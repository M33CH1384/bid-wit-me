import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOADING_LINES, LOADING_TIPS, shuffleTips, TableLoading } from '../src/TableLoading';

const TIPS = [{"id":1,"text":"Bid the tricks you can count, not the ones you hope for."},{"id":2,"text":"Unsure between two bids? Take the lower one. A bag hurts less than a set."},{"id":3,"text":"Aces are near-sure tricks. Kings need company in their suit to count."},{"id":4,"text":"Long spades are gold: every trump past your third often wins a late trick."},{"id":5,"text":"A short side suit is a trumping chance. Add a little to your bid for it."},{"id":6,"text":"Your bid plus your partner's is one contract. Think team total."},{"id":7,"text":"Partner bid big? You may only need to chip in a trick or two."},{"id":8,"text":"Count the jokers and deuces as they fall so you know which trumps are left."},{"id":9,"text":"Track each suit: once a suit has gone around twice, expect someone to trump it."},{"id":10,"text":"The Big Joker is the boss. Know where it is before you lead a high trump."},{"id":11,"text":"Never trump a trick your partner is already winning."},{"id":12,"text":"Don't fight your partner for tricks they've already got covered."},{"id":13,"text":"Go Nil only with low cards in every suit and few, small spades."},{"id":14,"text":"A lone king or queen in a short suit is a Nil trap. It has nowhere to hide."},{"id":15,"text":"Holding a joker or the 2 of spades? That's a trump trick. Skip the Nil."},{"id":16,"text":"Nil works best when your partner has a strong hand to protect you."},{"id":17,"text":"Partner bid Nil? Win the tricks they can't safely duck, even cheap ones."},{"id":18,"text":"Covering a Nil: lead your aces early so your partner can dump danger cards."},{"id":19,"text":"Covering a Nil: save your top trumps for the end, when your partner is most exposed."},{"id":20,"text":"Against a Nil, lead low cards and make the Nil bidder take something."},{"id":21,"text":"Made your bid? Start ducking. Play the highest card that still loses."},{"id":22,"text":"Bags add up fast and cost you big, so keep an eye on the count."},{"id":23,"text":"Opponents loaded with bags? Feed them cheap tricks they can't refuse."},{"id":24,"text":"Setting a big bid is worth more than dodging a bag or two."},{"id":25,"text":"Opponents bid high? Hold your top trumps to steal their key tricks."},{"id":26,"text":"Lead from your strong side suits early, before others run short and trump."},{"id":27,"text":"Don't burn high trumps on cheap early tricks. Save them for aces."},{"id":28,"text":"Once spades are broken, leading high trumps can pull the opponents' last trumps."},{"id":29,"text":"Late in the hand, count what's left. Your low trump may now be a winner."},{"id":30,"text":"Behind late in the game? A well-timed Nil can swing the score fast."}];

describe('table loading screen', () => {
  it('shows the wordmark, a shuffling line, and a progress bar before the table is drawn', () => {
    const html = renderToStaticMarkup(createElement(TableLoading, { progress: 0.42 }));
    expect(html).toContain('data-testid="table-loading"');
    expect(html).toContain('alt="Bid Wit Me"');
    expect(html).toContain('src="/assets/bwm-wordmark-white.svg"');
    expect(html).toContain(`>${LOADING_LINES[0]}<`);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('width:42%');
    expect(LOADING_LINES[0]).toBe('Shuffling the deck…');
  });

  it('ships the strategy list from the JSON file and shows one shuffled tip immediately', () => {
    const raw = readFileSync(new URL('../src/data/loading-tips.json', import.meta.url), 'utf8').trim();
    const file = JSON.parse(raw) as { id: number; text: string }[];
    expect(raw).toBe(JSON.stringify(TIPS));
    expect(file).toEqual(TIPS);
    expect(LOADING_TIPS).toEqual(file);
    const html = renderToStaticMarkup(createElement(TableLoading, { progress: 0.1 }));
    const id = Number(html.match(/data-tip="(\d+)"/)?.[1]);
    const shown = file.find((t) => t.id === id);
    expect(html).toContain('data-testid="table-loading-tip"');
    expect(shown).toBeTruthy();
    expect(html).toContain(shown!.text.replaceAll("'", '&#x27;'));
    const shuffled = shuffleTips(file, () => 0);
    expect(shuffled).toHaveLength(file.length);
    expect([...shuffled].sort((a, b) => a.id - b.id)).toEqual(file);
    expect(shuffled.map((t) => t.id)).not.toEqual(file.map((t) => t.id));
  });
});
