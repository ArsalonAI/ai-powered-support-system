import { describe, expect, it } from 'vitest';
import {
  AGENT_ALEX,
  AGENT_MARIA,
  AGENT_SAM,
  ticketFixtures,
  type TicketFixture,
} from './ticket-fixtures.js';

const AGENT_EMAILS = new Set([AGENT_ALEX, AGENT_MARIA, AGENT_SAM]);
const ids = new Set(ticketFixtures.map((f) => f.id));

/**
 * The fixtures are the Phase 2 development corpus *and* the Phase 5 eval set,
 * so a broken fixture is a broken eval that still passes. These assertions are
 * cheap and catch the ways that happens quietly.
 */
describe('ticket fixtures', () => {
  it('has unique ids', () => {
    expect(ids.size).toBe(ticketFixtures.length);
  });

  // At n=14 a >= 85% assertion means "at most 2 wrong", which a genuinely
  // 90%-accurate classifier fails about one run in six on variance alone. The
  // 5.18 eval is only trustworthy if the corpus is big enough that a red build
  // means a regression rather than a coin flip.
  it('has enough labelled examples for the 5.18 accuracy gate to be stable', () => {
    expect(ticketFixtures.length).toBeGreaterThanOrEqual(40);
  });

  // The default queue view is `status = OPEN AND waitingOn = US`. Server-side
  // pagination (2.12) cannot be exercised against a corpus that fits on one page.
  it('fills the default queue view deeply enough to paginate', () => {
    const inDefaultView = ticketFixtures.filter((f) => f.status === 'OPEN' && f.waitingOn === 'US');
    expect(inDefaultView.length).toBeGreaterThanOrEqual(25);
  });

  it('is roughly balanced across categories, so accuracy is not carried by one class', () => {
    const counts = new Map<string, number>();
    for (const fixture of ticketFixtures) {
      counts.set(fixture.expectedCategory, (counts.get(fixture.expectedCategory) ?? 0) + 1);
    }
    for (const [category, count] of counts) {
      expect(count, `too few ${category} fixtures`).toBeGreaterThanOrEqual(
        Math.floor(ticketFixtures.length / 6),
      );
    }
  });

  // The refund-vs-general boundary is where a classifier actually earns its
  // accuracy, so the corpus has to contain cases that sit on it.
  it('includes ambiguous cases, each carrying the rationale for its label', () => {
    const ambiguous = ticketFixtures.filter((f) => f.labelNote);
    expect(ambiguous.length).toBeGreaterThanOrEqual(4);
    for (const fixture of ambiguous) {
      expect(fixture.labelNote!.length).toBeGreaterThan(40);
    }
  });

  // A perfect classifier on the seeded aiCategory values would make the eval
  // meaningless — some fixtures must record the classifier disagreeing.
  it('records classifier disagreement on some fixtures', () => {
    const disagreements = ticketFixtures.filter(
      (f) => f.aiCategory && f.aiCategory !== f.expectedCategory,
    );
    expect(disagreements.length).toBeGreaterThanOrEqual(3);
  });

  it('covers all three categories in its labels', () => {
    const labels = new Set(ticketFixtures.map((f) => f.expectedCategory));
    expect(labels).toEqual(new Set(['TECHNICAL_QUESTION', 'REFUND_REQUEST', 'GENERAL_QUESTION']));
  });

  it('covers every status and both waiting-on values', () => {
    expect(new Set(ticketFixtures.map((f) => f.status))).toEqual(
      new Set(['OPEN', 'RESOLVED', 'CLOSED']),
    );
    expect(new Set(ticketFixtures.map((f) => f.waitingOn))).toEqual(new Set(['US', 'CUSTOMER']));
  });

  it('covers every classification state, including the failure that must not block an agent', () => {
    expect(new Set(ticketFixtures.map((f) => f.classificationState))).toEqual(
      new Set(['PENDING', 'DONE', 'FAILED']),
    );
  });

  it('includes a repeat customer, so cross-ticket history has something to show', () => {
    const counts = new Map<string, number>();
    for (const fixture of ticketFixtures) {
      counts.set(fixture.customerEmail, (counts.get(fixture.customerEmail) ?? 0) + 1);
    }
    expect([...counts.values()].some((count) => count >= 3)).toBe(true);
  });

  it('includes a withheld-draft ticket flagged for research', () => {
    expect(ticketFixtures.some((f) => f.flaggedForResearch)).toBe(true);
  });

  it('includes a corrected classification, which is the labeled eval signal', () => {
    const corrected = ticketFixtures.filter((f) => f.categoryCorrectedFrom);
    expect(corrected.length).toBeGreaterThan(0);
    for (const fixture of corrected) {
      expect(fixture.categoryCorrectedFrom).not.toBe(fixture.category);
    }
  });

  it('cross-links a continuation ticket to a closed ticket on the same Gmail thread', () => {
    const continuations = ticketFixtures.filter((f) => f.previousTicketId);
    expect(continuations.length).toBeGreaterThan(0);

    for (const continuation of continuations) {
      const previous = ticketFixtures.find((f) => f.id === continuation.previousTicketId);
      expect(previous, `dangling previousTicketId on ${continuation.id}`).toBeDefined();
      expect(previous?.status).toBe('CLOSED');
      expect(continuation.gmailThreadId).toBe(previous?.gmailThreadId);
    }
  });

  it.each(ticketFixtures.map((f): [string, TicketFixture] => [f.subject, f]))(
    'fixture %j is internally consistent',
    (_subject, fixture) => {
      expect(fixture.messages.length).toBeGreaterThan(0);
      // Every ticket starts with a customer email.
      expect(fixture.messages.some((m) => m.direction === 'INBOUND')).toBe(true);

      for (const message of fixture.messages) {
        if (message.direction === 'OUTBOUND') {
          // Every outbound message is sent by a named human.
          expect(message.authorEmail).toBeDefined();
          expect(AGENT_EMAILS.has(message.authorEmail as string)).toBe(true);
        } else {
          expect(message.authorEmail).toBeUndefined();
        }

        // The accept/edit signal is only meaningful on AI-drafted messages.
        if (!message.aiDrafted) {
          expect(message.aiDraftEdited).toBeUndefined();
        }
      }

      if (fixture.assigneeEmail) {
        expect(AGENT_EMAILS.has(fixture.assigneeEmail)).toBe(true);
      }

      // A classified ticket has a category; an unclassified one does not.
      if (fixture.classificationState === 'DONE') {
        expect(fixture.category).toBeDefined();
      } else {
        expect(fixture.category).toBeUndefined();
      }

      if (fixture.status === 'CLOSED') {
        expect(fixture.closedDaysAgo).toBeDefined();
      }
    },
  );
});
