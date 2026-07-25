import { describe, expect, it } from 'vitest';
import { HUMAN_LABELS, TicketCategory, TicketStatus, WaitingOn } from './domain.js';
import { apiErrorSchema } from './errors.js';

describe('domain enums', () => {
  it('exposes the three ticket categories from the PRD', () => {
    expect(Object.values(TicketCategory)).toEqual([
      'TECHNICAL_QUESTION',
      'REFUND_REQUEST',
      'GENERAL_QUESTION',
    ]);
  });

  it('exposes the three ticket statuses, with CLOSED last and terminal', () => {
    expect(Object.values(TicketStatus)).toEqual(['OPEN', 'RESOLVED', 'CLOSED']);
  });

  it('has a human label for every enum member it claims to label', () => {
    for (const value of Object.values(TicketCategory)) {
      expect(HUMAN_LABELS.ticketCategory[value]).toBeTruthy();
    }
    for (const value of Object.values(WaitingOn)) {
      expect(HUMAN_LABELS.waitingOn[value]).toBeTruthy();
    }
  });
});

describe('apiErrorSchema', () => {
  it('accepts a minimal error body', () => {
    const parsed = apiErrorSchema.parse({
      error: { code: 'NOT_FOUND', message: 'Ticket not found' },
    });
    expect(parsed.error.code).toBe('NOT_FOUND');
  });

  it('rejects an unknown error code', () => {
    expect(() => apiErrorSchema.parse({ error: { code: 'KABOOM', message: 'x' } })).toThrow();
  });
});
