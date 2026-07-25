import type { AdoptionStats, StatsResponse } from '@support/shared';
import { prisma } from '../db/prisma.js';

/**
 * The aggregates the Phase 7 dashboard renders. Included now because they
 * demonstrate something worth proving early: adoption is answerable from the
 * per-message flags alone, with no log to mine and nothing to reconstruct.
 */
export async function getStats(): Promise<StatsResponse> {
  const [tickets, customers, byStatus, byCategory, needsReply, unclassified, outbound, flagged] =
    await Promise.all([
      prisma.ticket.count(),
      prisma.customer.count(),
      prisma.ticket.groupBy({ by: ['status'], _count: true }),
      prisma.ticket.groupBy({ by: ['category'], _count: true }),
      prisma.ticket.count({ where: { status: 'OPEN', waitingOn: 'US' } }),
      prisma.ticket.count({ where: { classificationState: { in: ['PENDING', 'FAILED'] } } }),
      prisma.message.groupBy({
        by: ['aiDrafted', 'aiDraftEdited'],
        where: { direction: 'OUTBOUND' },
        _count: true,
      }),
      prisma.ticket.count({ where: { flaggedForResearch: true } }),
    ]);

  const sentReplies = outbound.reduce((total, row) => total + row._count, 0);
  const startedAsAiDraft = outbound
    .filter((row) => row.aiDrafted)
    .reduce((total, row) => total + row._count, 0);
  const editedBeforeSend = outbound
    .filter((row) => row.aiDrafted && row.aiDraftEdited)
    .reduce((total, row) => total + row._count, 0);

  const adoption: AdoptionStats = {
    sentReplies,
    startedAsAiDraft,
    editedBeforeSend,
    // Null rather than 0 when nothing has been sent: "no data yet" and "nobody
    // accepts the drafts" are opposite conclusions.
    acceptanceRate: sentReplies === 0 ? null : round(startedAsAiDraft / sentReplies),
    editRate: startedAsAiDraft === 0 ? null : round(editedBeforeSend / startedAsAiDraft),
    ticketsFlaggedForResearch: flagged,
  };

  return {
    tickets,
    customers,
    queue: {
      byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count])),
      byCategory: Object.fromEntries(
        byCategory.map((row) => [row.category ?? 'UNCLASSIFIED', row._count]),
      ),
      needsReply,
      unclassified,
    },
    adoption,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
