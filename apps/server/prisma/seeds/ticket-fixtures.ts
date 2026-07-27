/**
 * Ticket fixtures — a deliverable, not scaffolding.
 *
 * Nothing creates tickets until Phase 6, so Phases 2 and 5 are built and
 * evaluated entirely against this corpus. The `expectedCategory` on each
 * fixture is the human label the Phase 5 classification eval (5.18) asserts
 * against, so these bodies need to read like real customer email — including
 * the ambiguous ones, which are where a classifier actually earns its 85%.
 */
import type {
  ClassificationState,
  MessageDirection,
  TicketCategory,
  TicketStatus,
  WaitingOn,
} from '@support/shared';

export interface MessageFixture {
  direction: MessageDirection;
  /** Days before the seed run. Higher is older. */
  daysAgo: number;
  bodyText: string;
  /** Outbound only; must match a seeded agent's email. */
  authorEmail?: string;
  /** The 5.15 adoption flags. `aiDraftEdited` is null unless `aiDrafted`. */
  aiDrafted?: boolean;
  aiDraftEdited?: boolean;
}

export interface TicketFixture {
  id: string;
  customerEmail: string;
  customerName: string;
  subject: string;
  status: TicketStatus;
  waitingOn: WaitingOn;
  classificationState: ClassificationState;
  category?: TicketCategory;
  aiCategory?: TicketCategory;
  aiCategoryConfidence?: number;
  /** The human label for the classification eval. Always present. */
  expectedCategory: TicketCategory;
  /**
   * Why this label rather than the plausible alternative. Present only on the
   * genuinely ambiguous ones — when the eval fails, this is what tells you
   * whether the classifier was wrong or the label was.
   */
  labelNote?: string;
  assigneeEmail?: string;
  summary?: string;
  flaggedForResearch?: boolean;
  /** Days before the seed run. */
  resolvedDaysAgo?: number;
  closedDaysAgo?: number;
  gmailThreadId?: string;
  /** Cross-link: a reply to a closed ticket opens a new, linked ticket. */
  previousTicketId?: string;
  categoryCorrectedFrom?: TicketCategory;
  messages: MessageFixture[];
}

export const AGENT_ALEX = 'alex.chen@example.com';
export const AGENT_MARIA = 'maria.okonkwo@example.com';
export const AGENT_SAM = 'sam.delacroix@example.com';

export const ticketFixtures: TicketFixture[] = [
  {
    id: '11111111-1111-4111-8111-000000000001',
    customerEmail: 'dev@northwind-labs.io',
    customerName: 'Jordan Ellery',
    subject: 'Webhook retries stopped after upgrading to 2.4',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'TECHNICAL_QUESTION',
    aiCategory: 'TECHNICAL_QUESTION',
    aiCategoryConfidence: 0.94,
    expectedCategory: 'TECHNICAL_QUESTION',
    assigneeEmail: AGENT_ALEX,
    summary:
      'Customer upgraded to 2.4 and webhook deliveries stopped retrying after the first failure. Wants to know whether retry behaviour changed or whether their endpoint config needs updating.',
    gmailThreadId: 'thread-000001',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 1,
        bodyText: `Hi,

We upgraded to 2.4 on Tuesday and since then failed webhook deliveries are not being retried. Before the upgrade we'd see three retry attempts over about an hour; now there's a single attempt and then nothing.

Our endpoint was down for maintenance for ~20 minutes yesterday and we lost 34 events in that window. Did retry behaviour change in 2.4, or is there a new setting we need to enable?

Thanks,
Jordan`,
      },
    ],
  },

  {
    id: '11111111-1111-4111-8111-000000000002',
    customerEmail: 'k.thibault@mailbox.example',
    customerName: 'Kim Thibault',
    subject: 'Charged twice for the annual plan',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'REFUND_REQUEST',
    aiCategory: 'REFUND_REQUEST',
    aiCategoryConfidence: 0.97,
    expectedCategory: 'REFUND_REQUEST',
    summary:
      'Two annual charges on the same card three minutes apart. Customer wants one refunded and confirmation that only one subscription is active.',
    gmailThreadId: 'thread-000002',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 0,
        bodyText: `Hello,

I was charged twice for the annual plan this morning — two charges of $348.00, three minutes apart. I only clicked subscribe once; the first attempt showed an error page so I tried again.

Please refund one of them. I'd also like confirmation that I only have one active subscription, because I don't want to be double-billed again next year.

Kim`,
      },
    ],
  },

  {
    id: '11111111-1111-4111-8111-000000000003',
    customerEmail: 'ops@verdant-supply.example',
    customerName: 'Tomas Berg',
    subject: 'Do you support SSO on the team plan?',
    status: 'OPEN',
    waitingOn: 'CUSTOMER',
    classificationState: 'DONE',
    category: 'GENERAL_QUESTION',
    aiCategory: 'GENERAL_QUESTION',
    aiCategoryConfidence: 0.81,
    expectedCategory: 'GENERAL_QUESTION',
    assigneeEmail: AGENT_MARIA,
    summary:
      'Pre-sales question about SAML SSO availability and whether it requires the enterprise tier. Agent answered from the plan comparison; awaiting customer confirmation.',
    gmailThreadId: 'thread-000003',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 3,
        bodyText: `Hi there,

We're evaluating your product for a team of about 40 people. Our security review requires SAML SSO with Okta. Is that available on the team plan, or do we need to be on enterprise?

Also, if it is enterprise-only, is there a minimum seat count?

Best,
Tomas Berg
Verdant Supply`,
      },
      {
        direction: 'OUTBOUND',
        daysAgo: 2,
        authorEmail: AGENT_MARIA,
        aiDrafted: true,
        aiDraftEdited: true,
        bodyText: `Hi Tomas,

Thanks for looking at us for your team.

SAML SSO — including Okta — is available on the enterprise plan. The team plan supports Google and Microsoft social sign-in, but not SAML, so an Okta integration would need enterprise.

There's no hard minimum seat count on enterprise. At 40 seats you'd be well within the range we normally work with, and I'd be happy to put together pricing if it's useful.

Let me know if you'd like me to set that up.

Maria`,
      },
    ],
  },

  {
    id: '11111111-1111-4111-8111-000000000004',
    customerEmail: 'dana.whitfield@brightsideco.example',
    customerName: 'Dana Whitfield',
    subject: 'CSV export truncates at 1000 rows',
    status: 'RESOLVED',
    waitingOn: 'CUSTOMER',
    classificationState: 'DONE',
    category: 'TECHNICAL_QUESTION',
    aiCategory: 'TECHNICAL_QUESTION',
    aiCategoryConfidence: 0.91,
    expectedCategory: 'TECHNICAL_QUESTION',
    assigneeEmail: AGENT_ALEX,
    resolvedDaysAgo: 3,
    summary:
      'CSV exports capped at 1000 rows in the browser. Agent pointed to the scheduled export API for larger datasets; customer confirmed it worked.',
    gmailThreadId: 'thread-000004',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 6,
        bodyText: `Every CSV export I run stops at exactly 1000 rows. I have about 12,000 records in the view I'm exporting. Is this a limit or a bug?

Dana`,
      },
      {
        direction: 'OUTBOUND',
        daysAgo: 5,
        authorEmail: AGENT_ALEX,
        aiDrafted: true,
        aiDraftEdited: false,
        bodyText: `Hi Dana,

That's a limit rather than a bug — browser exports are capped at 1000 rows so the request doesn't time out on large views.

For anything bigger, use the scheduled export endpoint: it runs server-side and emails you a link when the file is ready, with no row cap. You'll find it under Settings → Data → Scheduled exports.

If you'd rather not set up a schedule, you can also filter the view down and export in batches, but the scheduled export is much less work for 12,000 records.

Alex`,
      },
      {
        direction: 'INBOUND',
        daysAgo: 4,
        bodyText: `That did it — got all 12,000 rows. Thanks for the quick answer.

Dana`,
      },
    ],
  },

  // --- Repeat customer: three tickets, one address. This is the difference
  // --- between a support inbox and a CRM, and it matters most here: a refund
  // --- request from someone who has already been refunded once.
  {
    id: '11111111-1111-4111-8111-000000000005',
    customerEmail: 'priya.raman@example.net',
    customerName: 'Priya Raman',
    subject: 'How do I change the email on my account?',
    status: 'CLOSED',
    waitingOn: 'CUSTOMER',
    classificationState: 'DONE',
    category: 'GENERAL_QUESTION',
    aiCategory: 'GENERAL_QUESTION',
    aiCategoryConfidence: 0.88,
    expectedCategory: 'GENERAL_QUESTION',
    assigneeEmail: AGENT_SAM,
    resolvedDaysAgo: 58,
    closedDaysAgo: 44,
    gmailThreadId: 'thread-000005',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 60,
        bodyText: `Hi, I need to change the email address on my account from my old work address. How do I do that?

Priya`,
      },
      {
        direction: 'OUTBOUND',
        daysAgo: 59,
        authorEmail: AGENT_SAM,
        aiDrafted: false,
        bodyText: `Hi Priya,

You can change it yourself under Settings → Account → Email address. We'll send a confirmation link to the new address; the change takes effect once you click it.

Your billing history and all your data stay on the same account.

Sam`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000006',
    customerEmail: 'priya.raman@example.net',
    customerName: 'Priya Raman',
    subject: 'Refund for the month I did not use',
    status: 'RESOLVED',
    waitingOn: 'CUSTOMER',
    classificationState: 'DONE',
    category: 'REFUND_REQUEST',
    aiCategory: 'REFUND_REQUEST',
    aiCategoryConfidence: 0.93,
    expectedCategory: 'REFUND_REQUEST',
    assigneeEmail: AGENT_SAM,
    resolvedDaysAgo: 20,
    summary:
      'Customer asked for a refund for a month during which they did not log in. Agent applied the goodwill exception and refunded one month.',
    gmailThreadId: 'thread-000006',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 24,
        bodyText: `Hi,

I was billed for March but didn't use the product at all that month — we were mid-migration and nobody logged in. Any chance of a refund for that month?

Priya`,
      },
      {
        direction: 'OUTBOUND',
        daysAgo: 23,
        authorEmail: AGENT_SAM,
        aiDrafted: true,
        aiDraftEdited: true,
        bodyText: `Hi Priya,

Normally we don't refund for unused time on a monthly plan, but a full month with no logins is a fair case for an exception, so I've refunded March. You'll see it back on the original card within 5–10 business days.

If you're expecting another quiet stretch, you can pause the subscription instead of paying through it — Settings → Billing → Pause. It keeps your data and stops the billing.

Sam`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000007',
    customerEmail: 'priya.raman@example.net',
    customerName: 'Priya Raman',
    subject: 'Another refund request — billed after cancelling',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'REFUND_REQUEST',
    aiCategory: 'REFUND_REQUEST',
    aiCategoryConfidence: 0.96,
    expectedCategory: 'REFUND_REQUEST',
    summary:
      'Customer says they cancelled before the renewal date but were billed anyway. Second refund request from this address in a month — check the earlier goodwill refund before answering.',
    gmailThreadId: 'thread-000007',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 0,
        bodyText: `Hello again,

I cancelled my subscription on the 28th, before the renewal on the 1st, but I've just been charged $29 anyway. Can you refund this one and make sure the cancellation actually went through this time?

I've now had to email about billing twice in a month, which is not a great look.

Priya`,
      },
    ],
  },

  {
    id: '11111111-1111-4111-8111-000000000008',
    customerEmail: 'finance@harborlight.example',
    customerName: 'Wes Adeyemi',
    subject: 'Where do I update the billing address on invoices?',
    status: 'OPEN',
    waitingOn: 'US',
    // Just ingested: the ticket is workable before the classifier has run.
    classificationState: 'PENDING',
    expectedCategory: 'GENERAL_QUESTION',
    gmailThreadId: 'thread-000008',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 0,
        bodyText: `Our invoices still show our old registered address. Where do I update that so it appears correctly on future invoices? We need it fixed before quarter end for our auditors.

Wes Adeyemi
Harborlight Ltd`,
      },
    ],
  },

  {
    id: '11111111-1111-4111-8111-000000000009',
    customerEmail: 'platform@cindermill.example',
    customerName: 'Rowan Petrov',
    subject: 'API returns 401 after rotating keys',
    status: 'OPEN',
    waitingOn: 'US',
    // Classifier failed. This surfaces a manual-triage badge and must never
    // block the agent from working the ticket.
    classificationState: 'FAILED',
    expectedCategory: 'TECHNICAL_QUESTION',
    gmailThreadId: 'thread-000009',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 1,
        bodyText: `We rotated our API keys this morning per your security advisory and now every request returns 401 unauthorized, including from the key's own test button in the dashboard.

The old key still works. Is there a propagation delay on new keys, or did the rotation not complete?

Rowan`,
      },
    ],
  },

  {
    id: '11111111-1111-4111-8111-00000000000a',
    customerEmail: 'hello@lantern-studio.example',
    customerName: 'Ines Marchetti',
    subject: 'Can we get a copy of your SOC 2 report?',
    status: 'OPEN',
    waitingOn: 'CUSTOMER',
    classificationState: 'DONE',
    category: 'GENERAL_QUESTION',
    aiCategory: 'GENERAL_QUESTION',
    aiCategoryConfidence: 0.86,
    expectedCategory: 'GENERAL_QUESTION',
    assigneeEmail: AGENT_MARIA,
    // Silent for over a week with the ball in the customer's court. Nothing
    // moves it any more — it is here so the ageing view has something in it.
    summary: 'Vendor security review; customer asked for the SOC 2 Type II report and a DPA.',
    gmailThreadId: 'thread-00000a',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 11,
        bodyText: `Hi,

Our client's procurement team is asking for your SOC 2 Type II report and a signed DPA before we can roll you out. Can you send both?

Ines`,
      },
      {
        direction: 'OUTBOUND',
        daysAgo: 9,
        authorEmail: AGENT_MARIA,
        aiDrafted: false,
        bodyText: `Hi Ines,

Both are available. The SOC 2 Type II report goes out under NDA — if you send me the signer's name and email I'll start that, and I'll attach our standard DPA for review at the same time.

Maria`,
      },
    ],
  },

  {
    id: '11111111-1111-4111-8111-00000000000b',
    customerEmail: 'accounts@quarrystone.example',
    customerName: 'Bea Nordqvist',
    subject: 'Chargeback filed — want to resolve directly instead',
    status: 'RESOLVED',
    waitingOn: 'CUSTOMER',
    classificationState: 'DONE',
    category: 'REFUND_REQUEST',
    aiCategory: 'GENERAL_QUESTION',
    aiCategoryConfidence: 0.52,
    // The classifier read this as a general question; an agent corrected it.
    // Corrections are the labeled eval data the accuracy metric is measured on.
    categoryCorrectedFrom: 'GENERAL_QUESTION',
    expectedCategory: 'REFUND_REQUEST',
    assigneeEmail: AGENT_ALEX,
    // Resolved a fortnight ago and still resolved: closing is a person's call.
    resolvedDaysAgo: 16,
    summary:
      'Customer filed a chargeback with their bank, then wrote in wanting to withdraw it and settle directly. Agent explained the process and refunded.',
    gmailThreadId: 'thread-00000b',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 20,
        bodyText: `Hi,

Our finance team filed a chargeback for the November invoice before checking with me — that was a mistake, the charge was legitimate but went to the wrong cost centre.

We'd rather sort this out with you directly than through the bank. What's the cleanest way to withdraw the dispute?

Bea`,
      },
      {
        direction: 'OUTBOUND',
        daysAgo: 19,
        authorEmail: AGENT_ALEX,
        aiDrafted: true,
        aiDraftEdited: true,
        bodyText: `Hi Bea,

Thanks for flagging it — that's easy to sort out.

Ask your bank to withdraw the dispute; once they do, the funds return to us automatically and nothing further is needed on your side. Withdrawal usually takes a few days to show up.

I'd rather you weren't out of pocket in the meantime, so I've issued a refund for the November invoice and will re-issue it against the correct cost centre once you confirm which one it should be.

Alex`,
      },
    ],
  },

  {
    id: '11111111-1111-4111-8111-00000000000c',
    customerEmail: 'r.okafor@stellarpath.example',
    customerName: 'Remi Okafor',
    subject: 'Data residency — can we pin our data to the EU?',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'GENERAL_QUESTION',
    aiCategory: 'GENERAL_QUESTION',
    aiCategoryConfidence: 0.74,
    expectedCategory: 'GENERAL_QUESTION',
    // Nothing in the knowledge base supports an answer, so the draft was
    // withheld and the ticket flagged for manual research. The rate of these
    // measures knowledge base coverage, not AI quality.
    flaggedForResearch: true,
    summary:
      'Customer asks whether data can be pinned to an EU region and what happens to backups. No knowledge base coverage for data residency — needs manual research.',
    gmailThreadId: 'thread-00000c',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 2,
        bodyText: `Hello,

Two questions from our legal review:

1. Can our data be pinned to an EU region, and is that configurable per workspace or only at signup?
2. Where do backups live? If the primary is in the EU but backups replicate to the US, that's a problem for us.

We need written answers to both before we can sign.

Remi Okafor`,
      },
    ],
  },

  // Closed ticket plus the new ticket a later reply created, cross-linked so
  // the history stays traversable. `closed` is terminal, never deleted.
  {
    id: '11111111-1111-4111-8111-00000000000d',
    customerEmail: 'sunil@meadowgate.example',
    customerName: 'Sunil Varma',
    subject: 'Import failed with "unexpected column" error',
    status: 'CLOSED',
    waitingOn: 'CUSTOMER',
    classificationState: 'DONE',
    category: 'TECHNICAL_QUESTION',
    aiCategory: 'TECHNICAL_QUESTION',
    aiCategoryConfidence: 0.9,
    expectedCategory: 'TECHNICAL_QUESTION',
    assigneeEmail: AGENT_ALEX,
    resolvedDaysAgo: 40,
    closedDaysAgo: 26,
    gmailThreadId: 'thread-00000d',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 42,
        bodyText: `Our nightly import failed with 'unexpected column: customer_ref'. The file hasn't changed in months. What do I need to fix?

Sunil`,
      },
      {
        direction: 'OUTBOUND',
        daysAgo: 41,
        authorEmail: AGENT_ALEX,
        aiDrafted: true,
        aiDraftEdited: false,
        bodyText: `Hi Sunil,

That error means the import mapping no longer matches the file's header row. The usual cause is a column added upstream — the importer is strict about unmapped columns rather than dropping data silently.

Open the import profile, re-run the mapping step against your current file, and either map customer_ref to a field or mark it ignored. The nightly run will pick up the updated profile automatically.

Alex`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-00000000000e',
    customerEmail: 'sunil@meadowgate.example',
    customerName: 'Sunil Varma',
    subject: 'Re: Import failed with "unexpected column" error',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'TECHNICAL_QUESTION',
    aiCategory: 'TECHNICAL_QUESTION',
    aiCategoryConfidence: 0.89,
    expectedCategory: 'TECHNICAL_QUESTION',
    // Same Gmail thread as the closed ticket above — reply mapping must resolve
    // to this one, not the closed original.
    gmailThreadId: 'thread-00000d',
    previousTicketId: '11111111-1111-4111-8111-00000000000d',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 1,
        bodyText: `This is happening again after our vendor added two more columns. Is there a way to make the importer ignore unknown columns by default instead of failing the whole run?

Sunil`,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Queue depth and eval mass.
  //
  // Two separate reasons these exist. The default view is `OPEN AND
  // waiting_on = us`, so server-side pagination (2.12) needs more than a
  // screenful of tickets in that state or it cannot be exercised against real
  // data. And the 5.18 eval asserts >= 85% accuracy against these labels: at
  // n=14 that is "at most 2 wrong", which a genuinely 90%-accurate classifier
  // fails roughly one run in six on variance alone. More labelled examples
  // tighten the interval enough that a red build means a real regression.
  //
  // Weighted toward refund-vs-general ambiguity, which is where a classifier
  // actually earns its accuracy — and where a miss costs an agent the most
  // triage time.
  // -------------------------------------------------------------------------

  {
    id: '11111111-1111-4111-8111-00000000000f',
    customerEmail: 'api-team@fenwick-digital.example',
    customerName: 'Casey Lindqvist',
    subject: '429s on the bulk endpoint since Monday',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'TECHNICAL_QUESTION',
    aiCategory: 'TECHNICAL_QUESTION',
    aiCategoryConfidence: 0.92,
    expectedCategory: 'TECHNICAL_QUESTION',
    gmailThreadId: 'thread-00000f',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 1,
        bodyText: `Since Monday we're getting 429s on /v1/bulk at about a third of the request rate we've been running for months. Nothing changed on our side — same batch size, same concurrency.

Was there a rate limit change? If so, what are the new numbers so we can size our queue correctly?

Casey`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000010',
    customerEmail: 'it@bramblewood-health.example',
    customerName: 'Nadia Oyelaran',
    subject: 'SSO login loop after updating our Okta metadata',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'TECHNICAL_QUESTION',
    aiCategory: 'TECHNICAL_QUESTION',
    aiCategoryConfidence: 0.87,
    expectedCategory: 'TECHNICAL_QUESTION',
    assigneeEmail: AGENT_ALEX,
    gmailThreadId: 'thread-000010',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 2,
        bodyText: `We rotated our Okta signing certificate and uploaded the new metadata. Now every user gets bounced between your login page and Okta indefinitely — no error, just a loop.

Rolling back the metadata didn't help. About 60 people can't log in. Is there a cache on your side that needs clearing?

Nadia`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000011',
    customerEmail: 'reports@calderwood.example',
    customerName: 'Theo Marsden',
    subject: 'Scheduled reports arriving with the wrong timezone',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'TECHNICAL_QUESTION',
    aiCategory: 'TECHNICAL_QUESTION',
    aiCategoryConfidence: 0.89,
    expectedCategory: 'TECHNICAL_QUESTION',
    gmailThreadId: 'thread-000011',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 3,
        bodyText: `Our daily report is scheduled for 08:00 and arrives at 03:00. The workspace timezone is set to Europe/London and my user profile says the same.

It was correct until the clocks changed. Does the schedule store a fixed UTC offset rather than the timezone?

Theo`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000012',
    customerEmail: 'm.santos@driftline.example',
    customerName: 'Mara Santos',
    subject: 'iOS app crashes immediately on launch after the 19 update',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'TECHNICAL_QUESTION',
    aiCategory: 'TECHNICAL_QUESTION',
    aiCategoryConfidence: 0.95,
    expectedCategory: 'TECHNICAL_QUESTION',
    gmailThreadId: 'thread-000012',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 1,
        bodyText: `Updated to iOS 19 last night and the app now crashes on the splash screen every time. Reinstalling didn't fix it. Two colleagues on iOS 18 are fine.

Is there a build in review, or a workaround in the meantime? I can send a crash log if that helps.

Mara`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000013',
    customerEmail: 'ops@thistledown.example',
    customerName: 'Gareth Pryce',
    subject: 'Search still showing records I deleted an hour ago',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'TECHNICAL_QUESTION',
    aiCategory: 'TECHNICAL_QUESTION',
    aiCategoryConfidence: 0.83,
    expectedCategory: 'TECHNICAL_QUESTION',
    gmailThreadId: 'thread-000013',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 0,
        bodyText: `I bulk-deleted about 400 records an hour ago. They're gone from the list view but search still returns them, and clicking through gives a "record not found" page.

Is the search index rebuilt on a schedule? Our team is getting confused by the ghost results.

Gareth`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000014',
    customerEmail: 'j.abara@northgate-legal.example',
    customerName: 'Joy Abara',
    subject: 'Two-factor codes being rejected as invalid',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'TECHNICAL_QUESTION',
    aiCategory: 'TECHNICAL_QUESTION',
    aiCategoryConfidence: 0.9,
    expectedCategory: 'TECHNICAL_QUESTION',
    gmailThreadId: 'thread-000014',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 0,
        bodyText: `My authenticator codes are all being rejected. I've checked my phone's clock is set automatically and tried three codes in a row.

I have backup codes but I'd rather not burn one if this is a known issue. Can you check whether my 2FA secret got reset?

Joy`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000015',
    customerEmail: 'dev@quillfeather.example',
    customerName: 'Ravi Chandrasekhar',
    subject: 'Sandbox data disappeared overnight',
    status: 'OPEN',
    waitingOn: 'CUSTOMER',
    classificationState: 'DONE',
    category: 'TECHNICAL_QUESTION',
    aiCategory: 'TECHNICAL_QUESTION',
    aiCategoryConfidence: 0.88,
    expectedCategory: 'TECHNICAL_QUESTION',
    assigneeEmail: AGENT_ALEX,
    summary:
      'Sandbox test data vanished overnight. Agent explained the weekly sandbox reset and pointed to the seeding script; awaiting confirmation.',
    gmailThreadId: 'thread-000015',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 5,
        bodyText: `All of our sandbox test data was gone this morning. We'd spent two days setting up fixtures for an integration test suite.

Was this a reset on your side? Is there any way to recover it?

Ravi`,
      },
      {
        direction: 'OUTBOUND',
        daysAgo: 4,
        authorEmail: AGENT_ALEX,
        aiDrafted: true,
        aiDraftEdited: true,
        bodyText: `Hi Ravi,

Sandboxes reset every Sunday at 00:00 UTC — it's how we keep them from drifting into a state nobody can reproduce. The data isn't recoverable after a reset, and I'm sorry that cost you two days.

The way teams usually handle this is a seeding script committed alongside the test suite, so re-populating is one command rather than two days. Our sandbox API accepts the same bulk endpoints as production, so the same script works for both.

Happy to look over your fixture setup if you want to send it across.

Alex`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000016',
    customerEmail: 'integrations@peregrine-cx.example',
    customerName: 'Lena Vasquez',
    subject: 'Integration creating duplicate records',
    status: 'RESOLVED',
    waitingOn: 'CUSTOMER',
    classificationState: 'DONE',
    category: 'TECHNICAL_QUESTION',
    aiCategory: 'TECHNICAL_QUESTION',
    aiCategoryConfidence: 0.91,
    expectedCategory: 'TECHNICAL_QUESTION',
    assigneeEmail: AGENT_MARIA,
    resolvedDaysAgo: 6,
    summary:
      'Sync created duplicates because the external ID field was not mapped, so every run inserted rather than upserted. Fixed by mapping it.',
    gmailThreadId: 'thread-000016',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 9,
        bodyText: `Our sync has created about 3,000 duplicate records over the last week — every contact now exists three or four times.

We haven't changed the integration config. How do we stop it and clean up what's already there?

Lena`,
      },
      {
        direction: 'OUTBOUND',
        daysAgo: 8,
        authorEmail: AGENT_MARIA,
        aiDrafted: true,
        aiDraftEdited: true,
        bodyText: `Hi Lena,

I've looked at your sync config: the external ID field isn't mapped, so each run has no way to recognise a record it has already written and inserts a new one instead of updating. That matches the three-to-four copies you're seeing.

Map External ID → your source system's record ID in the integration settings and the next run will start updating rather than inserting.

For the existing duplicates, the merge tool under Data → Duplicates can group by external ID once it's mapped and merge in bulk. Run it after the mapping change, not before.

Maria`,
      },
      {
        direction: 'INBOUND',
        daysAgo: 7,
        bodyText: `Mapped it and ran the merge — we're back to one record each. Thank you.

Lena`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000017',
    customerEmail: 'analytics@vireo-group.example',
    customerName: 'Ibrahim Toure',
    subject: 'Dashboard takes 40+ seconds to load',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'TECHNICAL_QUESTION',
    aiCategory: 'TECHNICAL_QUESTION',
    aiCategoryConfidence: 0.85,
    expectedCategory: 'TECHNICAL_QUESTION',
    gmailThreadId: 'thread-000017',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 2,
        bodyText: `Our main dashboard now takes 40-50 seconds to load and sometimes times out. We're at about 50,000 records, which I wouldn't have thought was large.

Is there a practical limit, or something in how we've built the dashboard that's causing it? Happy to restructure if you can tell me what's expensive.

Ibrahim`,
      },
    ],
  },

  {
    id: '11111111-1111-4111-8111-000000000018',
    customerEmail: 'p.hallberg@stonebridge.example',
    customerName: 'Petra Hallberg',
    subject: 'Cancel our contract and refund the remaining months',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'REFUND_REQUEST',
    aiCategory: 'REFUND_REQUEST',
    aiCategoryConfidence: 0.95,
    expectedCategory: 'REFUND_REQUEST',
    gmailThreadId: 'thread-000018',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 1,
        bodyText: `We've decided to move to a different vendor at the end of this month. We paid annually in February, so there are eight months left on the term.

Please cancel the account and refund the unused portion. Let me know what you need from me to process it.

Petra Hallberg
Stonebridge`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000019',
    customerEmail: 'billing@arclight-media.example',
    customerName: 'Dominic Ferraro',
    subject: 'Prorated credit after downgrading mid-cycle?',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'REFUND_REQUEST',
    aiCategory: 'GENERAL_QUESTION',
    aiCategoryConfidence: 0.58,
    expectedCategory: 'REFUND_REQUEST',
    labelNote:
      'Reads like a billing how-does-it-work question, but it is a request for money back on a charge already taken, which is what the refund category covers. The classifier reaching for GENERAL_QUESTION here is the expected failure mode.',
    gmailThreadId: 'thread-000019',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 0,
        bodyText: `We downgraded from 40 seats to 22 last week, ten days into the billing month. The invoice still shows the full 40 seats.

Do you issue a prorated credit for the seats we gave back, or does the change only take effect next cycle? If it's a credit I'd like it applied to this invoice rather than the next one.

Dominic`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-00000000001a',
    customerEmail: 'sara.whitlock@example.org',
    customerName: 'Sara Whitlock',
    subject: 'Charged after my trial ended — I never subscribed',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'REFUND_REQUEST',
    aiCategory: 'REFUND_REQUEST',
    aiCategoryConfidence: 0.94,
    expectedCategory: 'REFUND_REQUEST',
    gmailThreadId: 'thread-00001a',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 0,
        bodyText: `I signed up for the 14-day trial and forgot about it. I've just been charged $49 with no warning email that the trial was ending.

I haven't logged in since the first week. Please refund it and close the account.

Sara`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-00000000001b',
    customerEmail: 'ap@holloway-partners.example',
    customerName: 'Ngozi Eze',
    subject: 'Bought 10 extra seats twice by mistake',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'REFUND_REQUEST',
    aiCategory: 'REFUND_REQUEST',
    aiCategoryConfidence: 0.91,
    expectedCategory: 'REFUND_REQUEST',
    gmailThreadId: 'thread-00001b',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 2,
        bodyText: `Two people on our team each added 10 seats on Tuesday, not realising the other had done it. We now have 20 extra seats and only needed 10.

Can you remove 10 and refund that portion? The account shows 65 seats, it should be 55.

Ngozi`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-00000000001c',
    customerEmail: 'procurement@littlefield.example',
    customerName: 'Colm Brennan',
    subject: "What's your refund policy on annual plans?",
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'REFUND_REQUEST',
    aiCategory: 'GENERAL_QUESTION',
    aiCategoryConfidence: 0.61,
    expectedCategory: 'REFUND_REQUEST',
    labelNote:
      'A policy question with no charge in dispute yet, so GENERAL_QUESTION is defensible — but the refund category is defined by subject matter, and routing it to whoever handles refunds is the useful outcome. Kept as a deliberate boundary case.',
    gmailThreadId: 'thread-00001c',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 1,
        bodyText: `Before we commit to the annual plan, our finance team wants to know your refund terms. Specifically: if we cancel at month four, is anything refundable, or is the annual commitment firm?

Also, is there a cooling-off period after signing?

Colm Brennan`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-00000000001d',
    customerEmail: 'h.nakamura@example.com',
    customerName: 'Haruto Nakamura',
    subject: 'My bank flagged your charge as fraudulent',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'REFUND_REQUEST',
    aiCategory: 'REFUND_REQUEST',
    aiCategoryConfidence: 0.79,
    expectedCategory: 'REFUND_REQUEST',
    gmailThreadId: 'thread-00001d',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 1,
        bodyText: `My bank blocked your charge and flagged it as potential fraud — apparently the merchant name on the statement doesn't match your company name at all.

I do want to keep the subscription. What name should I tell them to expect, and has the payment failed entirely or will it retry?

Haruto`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-00000000001e',
    customerEmail: 'freya.lindberg@example.net',
    customerName: 'Freya Lindberg',
    subject: 'Cancelled during the trial but still charged',
    status: 'RESOLVED',
    waitingOn: 'CUSTOMER',
    classificationState: 'DONE',
    category: 'REFUND_REQUEST',
    aiCategory: 'REFUND_REQUEST',
    aiCategoryConfidence: 0.93,
    expectedCategory: 'REFUND_REQUEST',
    assigneeEmail: AGENT_SAM,
    resolvedDaysAgo: 8,
    summary:
      'Customer cancelled during the trial but the cancellation did not save; charge refunded and the account closed.',
    gmailThreadId: 'thread-00001e',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 12,
        bodyText: `I cancelled two days before the trial ended and still got charged. I have the confirmation screen but no email.

Freya`,
      },
      {
        direction: 'OUTBOUND',
        daysAgo: 11,
        authorEmail: AGENT_SAM,
        aiDrafted: true,
        aiDraftEdited: false,
        bodyText: `Hi Freya,

You're right — the cancellation didn't save, which is why there's no confirmation email. That's our fault, not yours.

I've refunded the charge in full and closed the account. You'll see the money back on your card within 5-10 business days, and there'll be nothing further.

Sorry for the trouble.

Sam`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-00000000001f',
    customerEmail: 'accounts@merriweather-co.example',
    customerName: 'Alice Dunmore',
    subject: 'AP paid the same invoice twice',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'REFUND_REQUEST',
    aiCategory: 'REFUND_REQUEST',
    aiCategoryConfidence: 0.88,
    expectedCategory: 'REFUND_REQUEST',
    gmailThreadId: 'thread-00001f',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 3,
        bodyText: `Our accounts payable team paid invoice INV-4471 twice — once by card on the 3rd and again by bank transfer on the 11th.

We'd prefer the second payment back rather than held as credit, since it came out of a different budget line. Can you arrange that?

Alice Dunmore`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000020',
    customerEmail: 'finance@oakhurst-tech.example',
    customerName: 'Marcus Reinholt',
    subject: 'Credit note rather than a refund, if possible',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'REFUND_REQUEST',
    aiCategory: 'GENERAL_QUESTION',
    aiCategoryConfidence: 0.55,
    expectedCategory: 'REFUND_REQUEST',
    labelNote:
      'Asks for a credit note instead of money back, so it reads as an invoicing question. Still a billing correction on a charge already taken — the boundary the classifier most often gets wrong.',
    gmailThreadId: 'thread-000020',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 4,
        bodyText: `We were overcharged by roughly $600 on last month's invoice — a seat count that should have dropped in January.

Rather than a refund to the card, could you issue a credit note we can offset against next quarter? Our finance system handles that more cleanly than an incoming refund.

Marcus`,
      },
    ],
  },

  {
    id: '11111111-1111-4111-8111-000000000021',
    customerEmail: 'director@riverbend-trust.example',
    customerName: 'Yolanda Pike',
    subject: 'Do you offer nonprofit pricing?',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'GENERAL_QUESTION',
    aiCategory: 'GENERAL_QUESTION',
    aiCategoryConfidence: 0.87,
    expectedCategory: 'GENERAL_QUESTION',
    gmailThreadId: 'thread-000021',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 1,
        bodyText: `We're a registered charity with 15 staff. Do you offer nonprofit or educational pricing, and if so what documentation do you need?

Yolanda Pike
Riverbend Trust`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000022',
    customerEmail: 'tech@shorelark.example',
    customerName: 'Bran Eriksson',
    subject: 'Is there a public changelog?',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'GENERAL_QUESTION',
    aiCategory: 'GENERAL_QUESTION',
    aiCategoryConfidence: 0.8,
    expectedCategory: 'GENERAL_QUESTION',
    gmailThreadId: 'thread-000022',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 2,
        bodyText: `Is there a public changelog or release notes feed we can subscribe to? We were caught out by a UI change last month that we'd have briefed our team on if we'd known.

An RSS feed or a mailing list would both work.

Bran`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000023',
    customerEmail: 'vat@continental-imports.example',
    customerName: 'Elif Demirci',
    subject: 'Add our VAT number to invoices',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'GENERAL_QUESTION',
    aiCategory: 'REFUND_REQUEST',
    aiCategoryConfidence: 0.49,
    expectedCategory: 'GENERAL_QUESTION',
    labelNote:
      'Mentions invoices and tax, so the classifier drifts toward the refund category. Nothing is disputed and no money is asked for — this is an account settings question.',
    gmailThreadId: 'thread-000023',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 2,
        bodyText: `Our invoices don't show our VAT number, which our accountant needs for the reverse charge.

Where do I add it so it appears on future invoices, and can past invoices be reissued with it?

Elif Demirci`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000024',
    customerEmail: 'l.okonjo@brightpath-ed.example',
    customerName: 'Lawrence Okonjo',
    subject: 'Onboarding training for a new team',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'GENERAL_QUESTION',
    aiCategory: 'GENERAL_QUESTION',
    aiCategoryConfidence: 0.84,
    expectedCategory: 'GENERAL_QUESTION',
    gmailThreadId: 'thread-000024',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 3,
        bodyText: `We're rolling this out to 30 new users next month. Do you run live onboarding sessions, or is it self-serve documentation only?

If there are recorded walkthroughs we could point people at, that would help too.

Lawrence`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000025',
    customerEmail: 'partnerships@vantage-consulting.example',
    customerName: 'Simone Aubert',
    subject: 'Reseller or referral programme?',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'GENERAL_QUESTION',
    aiCategory: 'GENERAL_QUESTION',
    aiCategoryConfidence: 0.82,
    expectedCategory: 'GENERAL_QUESTION',
    gmailThreadId: 'thread-000025',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 4,
        bodyText: `We're a consultancy that implements tools like yours for mid-market clients. Do you have a reseller or referral arrangement?

We'd be looking at perhaps six to eight client deployments a year.

Simone Aubert
Vantage Consulting`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000026',
    customerEmail: 'accessibility@publicworks-dept.example',
    customerName: 'Deborah Kwan',
    subject: 'VPAT / accessibility conformance report',
    status: 'OPEN',
    waitingOn: 'US',
    classificationState: 'DONE',
    category: 'GENERAL_QUESTION',
    aiCategory: 'GENERAL_QUESTION',
    aiCategoryConfidence: 0.77,
    expectedCategory: 'GENERAL_QUESTION',
    // No knowledge base coverage for accessibility conformance — a second
    // withheld-draft case, so the grounding gate is exercised on more than one
    // ticket and the coverage metric has something to move.
    flaggedForResearch: true,
    gmailThreadId: 'thread-000026',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 2,
        bodyText: `Our procurement process requires a VPAT or equivalent accessibility conformance report before purchase. Do you have one, and which WCAG level does it cover?

If you don't have a formal VPAT, a statement of known conformance gaps would probably satisfy our review.

Deborah Kwan`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000027',
    customerEmail: 'cto@halcyon-systems.example',
    customerName: 'Anders Ruud',
    subject: 'Uptime commitment for the enterprise plan',
    status: 'OPEN',
    waitingOn: 'CUSTOMER',
    classificationState: 'DONE',
    category: 'GENERAL_QUESTION',
    aiCategory: 'GENERAL_QUESTION',
    aiCategoryConfidence: 0.85,
    expectedCategory: 'GENERAL_QUESTION',
    assigneeEmail: AGENT_MARIA,
    summary:
      'Asked about the contractual uptime commitment and service credits; agent sent the SLA terms and is waiting on their legal review.',
    gmailThreadId: 'thread-000027',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 6,
        bodyText: `What uptime do you commit to contractually on the enterprise plan, and are there service credits if you miss it?

Anders`,
      },
      {
        direction: 'OUTBOUND',
        daysAgo: 5,
        authorEmail: AGENT_MARIA,
        aiDrafted: false,
        bodyText: `Hi Anders,

Enterprise carries a 99.9% monthly uptime commitment with service credits on a sliding scale below that — 10% of the monthly fee under 99.9%, rising to 30% under 99.0%. Planned maintenance is excluded and announced at least 72 hours ahead.

I've attached the full SLA terms for your legal team. Happy to walk through anything in it.

Maria`,
      },
    ],
  },
  {
    id: '11111111-1111-4111-8111-000000000028',
    customerEmail: 'jamie.fletcher@example.com',
    customerName: 'Jamie Fletcher',
    subject: 'Job application — customer success role',
    status: 'OPEN',
    waitingOn: 'US',
    // Deliberately unclassified: a borderline non-ticket. It is not spam, so it
    // becomes a ticket for an agent to close rather than being dropped — false
    // negatives cost a click, false positives lose a customer.
    classificationState: 'PENDING',
    expectedCategory: 'GENERAL_QUESTION',
    labelNote:
      'Not a support request at all. Lands in the catch-all category by design, which is also where the classifier should put anything it is unsure about.',
    gmailThreadId: 'thread-000028',
    messages: [
      {
        direction: 'INBOUND',
        daysAgo: 1,
        bodyText: `Hi,

I saw the customer success opening on your careers page but the application form wouldn't submit. I've attached my CV — could you pass it to the hiring manager?

Thanks,
Jamie Fletcher`,
      },
    ],
  },
];
