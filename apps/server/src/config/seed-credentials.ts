/**
 * The password every seeded agent account shares.
 *
 * It lives in `src/` rather than beside the seed that uses it because the
 * developer dashboard and the OpenAPI description display it, and `prisma/` is
 * outside the build's `rootDir` — importing upward from `src/` compiles under
 * `tsc --noEmit` and then fails `pnpm build`. The dependency runs the other
 * way: `prisma/seeds/users.ts` imports this.
 *
 * Development only. It is printed by `pnpm db:seed`, shown on `/api/dev`, and
 * named in the README — it is a convenience for driving a local corpus, never a
 * credential for anything real. The bootstrap admin's password is separate,
 * comes from `.env`, and is deliberately never displayed.
 */
export const SEED_AGENT_PASSWORD = 'dev-password-change-me';
