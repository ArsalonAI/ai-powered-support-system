/**
 * Domain enums shared by the API and the web client.
 *
 * These mirror the Prisma enums one-for-one and are the wire format. Prisma
 * generates its own enum objects at runtime; `apps/server/src/domain/enums.ts`
 * asserts at compile time that the two never drift.
 */

export const Role = {
  AGENT: 'AGENT',
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** Ticket lifecycle. `CLOSED` is terminal — see the PRD's transition diagram. */
export const TicketStatus = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

/**
 * Exactly one category per ticket, assigned by the classifier at ingest.
 * `GENERAL_QUESTION` is the catch-all and therefore also where the classifier
 * puts anything it is unsure about.
 */
export const TicketCategory = {
  TECHNICAL_QUESTION: 'TECHNICAL_QUESTION',
  REFUND_REQUEST: 'REFUND_REQUEST',
  GENERAL_QUESTION: 'GENERAL_QUESTION',
} as const;
export type TicketCategory = (typeof TicketCategory)[keyof typeof TicketCategory];

/** The single most important triage signal: does this need a human right now? */
export const WaitingOn = {
  US: 'US',
  CUSTOMER: 'CUSTOMER',
} as const;
export type WaitingOn = (typeof WaitingOn)[keyof typeof WaitingOn];

/** Whether the classifier has run. `FAILED` surfaces a manual-triage badge and never blocks the agent. */
export const ClassificationState = {
  PENDING: 'PENDING',
  DONE: 'DONE',
  FAILED: 'FAILED',
} as const;
export type ClassificationState = (typeof ClassificationState)[keyof typeof ClassificationState];

/** Inbound = from the customer, outbound = sent by a named human agent. */
export const MessageDirection = {
  INBOUND: 'INBOUND',
  OUTBOUND: 'OUTBOUND',
} as const;
export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection];

/** Background work processed by the single worker task. */
export const JobType = {
  CLASSIFY_TICKET: 'CLASSIFY_TICKET',
  SUMMARIZE_TICKET: 'SUMMARIZE_TICKET',
  DRAFT_REPLY: 'DRAFT_REPLY',
  SEND_EMAIL: 'SEND_EMAIL',
} as const;
export type JobType = (typeof JobType)[keyof typeof JobType];

export const JobStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  DEAD: 'DEAD',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

/** Why a draft was withheld. Withheld drafts measure knowledge base coverage, not AI quality. */
export const DraftState = {
  PENDING: 'PENDING',
  READY: 'READY',
  WITHHELD_NO_GROUNDING: 'WITHHELD_NO_GROUNDING',
  FAILED: 'FAILED',
} as const;
export type DraftState = (typeof DraftState)[keyof typeof DraftState];

export const HUMAN_LABELS = {
  role: {
    AGENT: 'Agent',
    ADMIN: 'Admin',
  },
  ticketStatus: {
    OPEN: 'Open',
    RESOLVED: 'Resolved',
    CLOSED: 'Closed',
  },
  ticketCategory: {
    TECHNICAL_QUESTION: 'Technical question',
    REFUND_REQUEST: 'Refund request',
    GENERAL_QUESTION: 'General question',
  },
  waitingOn: {
    US: 'Us',
    CUSTOMER: 'Customer',
  },
  classificationState: {
    PENDING: 'Pending',
    DONE: 'Done',
    FAILED: 'Failed',
  },
} as const;
