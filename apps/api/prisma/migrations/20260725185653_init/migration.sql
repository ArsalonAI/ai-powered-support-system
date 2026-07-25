-- CreateEnum
CREATE TYPE "Role" AS ENUM ('AGENT', 'ADMIN');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('TECHNICAL_QUESTION', 'REFUND_REQUEST', 'GENERAL_QUESTION');

-- CreateEnum
CREATE TYPE "WaitingOn" AS ENUM ('US', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "ClassificationState" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "DraftState" AS ENUM ('PENDING', 'READY', 'WITHHELD_NO_GROUNDING', 'FAILED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('CLASSIFY_TICKET', 'SUMMARIZE_TICKET', 'DRAFT_REPLY', 'SEND_EMAIL');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'AGENT',
    "passwordHash" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "sid" TEXT NOT NULL,
    "sess" JSONB NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,
    "userId" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

-- CreateTable
CREATE TABLE "invite_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reset_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "customerId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "waitingOn" "WaitingOn" NOT NULL DEFAULT 'US',
    "classificationState" "ClassificationState" NOT NULL DEFAULT 'PENDING',
    "category" "TicketCategory",
    "aiCategory" "TicketCategory",
    "aiCategoryConfidence" DOUBLE PRECISION,
    "categoryCorrectedAt" TIMESTAMP(3),
    "categoryCorrectedById" TEXT,
    "assigneeId" TEXT,
    "flaggedForResearch" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT,
    "summaryGeneratedAt" TIMESTAMP(3),
    "gmailThreadId" TEXT,
    "previousTicketId" TEXT,
    "firstInboundAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "authorId" TEXT,
    "subject" TEXT,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "aiDrafted" BOOLEAN NOT NULL,
    "aiDraftEdited" BOOLEAN,
    "sourceDraftId" TEXT,
    "gmailMessageId" TEXT,
    "gmailThreadId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT,
    "gmailAttachmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drafts" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "state" "DraftState" NOT NULL DEFAULT 'PENDING',
    "body" TEXT,
    "withheldReason" TEXT,
    "model" TEXT,
    "effort" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "latencyMs" INTEGER,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_citations" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "kbDocumentId" TEXT NOT NULL,
    "quote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_documents" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "ticketId" TEXT,
    "dedupeKey" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL DEFAULT 'USER',
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ticketId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "emailKey" TEXT NOT NULL,
    "ipKey" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailbox_state" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "historyId" TEXT,
    "lastPolledAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastResyncAt" TIMESTAMP(3),
    "lastPollError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mailbox_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_isActive_idx" ON "users"("isActive");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "session_expire_idx" ON "session"("expire");

-- CreateIndex
CREATE UNIQUE INDEX "invite_tokens_tokenHash_key" ON "invite_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "invite_tokens_userId_idx" ON "invite_tokens"("userId");

-- CreateIndex
CREATE INDEX "invite_tokens_expiresAt_idx" ON "invite_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "reset_tokens_tokenHash_key" ON "reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "reset_tokens_userId_idx" ON "reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "reset_tokens_expiresAt_idx" ON "reset_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets"("number");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_previousTicketId_key" ON "tickets"("previousTicketId");

-- CreateIndex
CREATE INDEX "tickets_status_waitingOn_createdAt_idx" ON "tickets"("status", "waitingOn", "createdAt");

-- CreateIndex
CREATE INDEX "tickets_status_category_createdAt_idx" ON "tickets"("status", "category", "createdAt");

-- CreateIndex
CREATE INDEX "tickets_assigneeId_status_idx" ON "tickets"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "tickets_customerId_createdAt_idx" ON "tickets"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "tickets_gmailThreadId_idx" ON "tickets"("gmailThreadId");

-- CreateIndex
CREATE INDEX "tickets_status_waitingOn_lastOutboundAt_idx" ON "tickets"("status", "waitingOn", "lastOutboundAt");

-- CreateIndex
CREATE INDEX "tickets_status_resolvedAt_idx" ON "tickets"("status", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "messages_gmailMessageId_key" ON "messages"("gmailMessageId");

-- CreateIndex
CREATE INDEX "messages_ticketId_occurredAt_idx" ON "messages"("ticketId", "occurredAt");

-- CreateIndex
CREATE INDEX "messages_authorId_occurredAt_idx" ON "messages"("authorId", "occurredAt");

-- CreateIndex
CREATE INDEX "messages_direction_occurredAt_idx" ON "messages"("direction", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storageKey_key" ON "attachments"("storageKey");

-- CreateIndex
CREATE INDEX "attachments_messageId_idx" ON "attachments"("messageId");

-- CreateIndex
CREATE INDEX "drafts_ticketId_generatedAt_idx" ON "drafts"("ticketId", "generatedAt");

-- CreateIndex
CREATE INDEX "drafts_state_generatedAt_idx" ON "drafts"("state", "generatedAt");

-- CreateIndex
CREATE INDEX "draft_citations_kbDocumentId_idx" ON "draft_citations"("kbDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "draft_citations_draftId_kbDocumentId_key" ON "draft_citations"("draftId", "kbDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "kb_documents_slug_key" ON "kb_documents"("slug");

-- CreateIndex
CREATE INDEX "kb_documents_archivedAt_idx" ON "kb_documents"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_dedupeKey_key" ON "jobs"("dedupeKey");

-- CreateIndex
CREATE INDEX "jobs_status_runAt_idx" ON "jobs"("status", "runAt");

-- CreateIndex
CREATE INDEX "jobs_ticketId_idx" ON "jobs"("ticketId");

-- CreateIndex
CREATE INDEX "audit_events_ticketId_createdAt_idx" ON "audit_events"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_actorId_createdAt_idx" ON "audit_events"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_createdAt_idx" ON "audit_events"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_action_createdAt_idx" ON "audit_events"("action", "createdAt");

-- CreateIndex
CREATE INDEX "login_attempts_emailKey_occurredAt_idx" ON "login_attempts"("emailKey", "occurredAt");

-- CreateIndex
CREATE INDEX "login_attempts_ipKey_occurredAt_idx" ON "login_attempts"("ipKey", "occurredAt");

-- CreateIndex
CREATE INDEX "login_attempts_occurredAt_idx" ON "login_attempts"("occurredAt");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_tokens" ADD CONSTRAINT "invite_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_tokens" ADD CONSTRAINT "invite_tokens_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reset_tokens" ADD CONSTRAINT "reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_categoryCorrectedById_fkey" FOREIGN KEY ("categoryCorrectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_previousTicketId_fkey" FOREIGN KEY ("previousTicketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sourceDraftId_fkey" FOREIGN KEY ("sourceDraftId") REFERENCES "drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_citations" ADD CONSTRAINT "draft_citations_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_citations" ADD CONSTRAINT "draft_citations_kbDocumentId_fkey" FOREIGN KEY ("kbDocumentId") REFERENCES "kb_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariants Prisma's schema language cannot express.
--
-- These are database-level because the application is not the only writer:
-- seeds, one-off scripts, and a psql session all bypass it. Each of these
-- three failures is silent — the row is written, nothing errors, and the
-- damage is only visible later in a metric or an audit trail that cannot be
-- reconstructed.
-- ---------------------------------------------------------------------------

-- Every outbound message is sent by a named human (PRD, Users & Roles).
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_outbound_author_ck"
  CHECK ("direction" = 'INBOUND' OR "authorId" IS NOT NULL);

-- The AI-drafted / edited-before-send pair is the accept/edit/reject signal the
-- success metrics depend on, and it cannot be reconstructed later. `aiDraftEdited`
-- is meaningful only for drafted messages, and mandatory for them.
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_ai_flags_ck"
  CHECK (
    ("aiDrafted" = false AND "aiDraftEdited" IS NULL)
    OR ("aiDrafted" = true AND "aiDraftEdited" IS NOT NULL)
  );

-- An audit entry attributed to a user must name one; only the system acts
-- anonymously (the timed sweeps).
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_actor_ck"
  CHECK (
    ("actorType" = 'USER' AND "actorId" IS NOT NULL)
    OR ("actorType" = 'SYSTEM' AND "actorId" IS NULL)
  );
