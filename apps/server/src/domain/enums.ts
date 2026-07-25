import type { $Enums } from '@prisma/client';
import type {
  ClassificationState,
  DraftState,
  JobStatus,
  JobType,
  MessageDirection,
  Role,
  TicketCategory,
  TicketStatus,
  WaitingOn,
} from '@support/shared';

/**
 * The Prisma enums and the shared wire enums are two declarations of the same
 * thing. These checks fail the typecheck the moment they drift, which is the
 * only warning you get before a value that is valid in the database becomes
 * unrepresentable on the client.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type _RoleMatches = Assert<Equal<$Enums.Role, Role>>;
export type _TicketStatusMatches = Assert<Equal<$Enums.TicketStatus, TicketStatus>>;
export type _TicketCategoryMatches = Assert<Equal<$Enums.TicketCategory, TicketCategory>>;
export type _WaitingOnMatches = Assert<Equal<$Enums.WaitingOn, WaitingOn>>;
export type _ClassificationStateMatches = Assert<
  Equal<$Enums.ClassificationState, ClassificationState>
>;
export type _MessageDirectionMatches = Assert<Equal<$Enums.MessageDirection, MessageDirection>>;
export type _DraftStateMatches = Assert<Equal<$Enums.DraftState, DraftState>>;
export type _JobTypeMatches = Assert<Equal<$Enums.JobType, JobType>>;
export type _JobStatusMatches = Assert<Equal<$Enums.JobStatus, JobStatus>>;
