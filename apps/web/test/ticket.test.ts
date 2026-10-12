import { describe, expect, it } from 'vitest';
import { STATS_OFF_LABEL, TICKET_RETRY_MS, ticketPlan } from '../src/social/store';

describe('account ticket retry', () => {
  it('a slow account load retries and does not show the chip yet', () => {
    expect(ticketPlan({ ready: false, userId: null, username: null, ticket: null })).toEqual({ ticket: null, retry: true, statsOff: false });
  });
  it('a guest does not retry or show the chip', () => {
    expect(ticketPlan({ ready: true, userId: null, username: null, ticket: null })).toEqual({ ticket: null, retry: false, statsOff: false });
  });
  it('a signed-in user with no ticket keeps retrying and shows the chip', () => {
    expect(ticketPlan({ ready: true, userId: 'ed41194162a842d61600fdf573d9a9d5', username: 'M33CH', ticket: null })).toEqual({ ticket: null, retry: true, statsOff: true });
    expect(STATS_OFF_LABEL).toBe('Stats off, tap to reconnect');
    expect(TICKET_RETRY_MS).toBeGreaterThan(1000);
  });
  it('a ticket links the seat and clears the chip', () => {
    expect(ticketPlan({ ready: true, userId: 'u', username: 'M33CH', ticket: 'tok' })).toEqual({ ticket: 'tok', retry: false, statsOff: false });
  });
});
