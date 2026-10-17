import { describe, expect, it } from 'vitest';
import { parseClientMsg } from '../src/index';

describe('misdeal on the wire', () => {
  it('a misdeal act survives client-message validation (online tables can call it)', () => {
    expect(parseClientMsg({ t: 'act', action: { type: 'misdeal' }, seq: 3 }))
      .toEqual({ t: 'act', action: { type: 'misdeal' }, seq: 3 });
    expect(parseClientMsg(JSON.stringify({ t: 'act', action: { type: 'misdeal' } })))
      .toEqual({ t: 'act', action: { type: 'misdeal' } });
  });

  it('unknown actions are still dropped', () => {
    expect(parseClientMsg({ t: 'act', action: { type: 'redealEverything' } })).toBeNull();
  });
});
