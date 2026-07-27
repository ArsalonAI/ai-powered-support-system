import { readFile } from 'node:fs/promises';
import path from 'node:path';
import express, { Router } from 'express';
import { SEED_AGENT_PASSWORD } from '../../config/seed-credentials.js';
import { env, isProduction } from '../../config/env.js';
import { currentUser } from '../../auth/current-user.js';
import { prisma } from '../../db/prisma.js';

/**
 * A developer dashboard for driving the app by hand: who you can sign in as,
 * what the tests cover, and links to everything else.
 *
 * **Dev-only, and behind the session like everything else.** It prints working
 * credentials, so it refuses to construct in production the same way the
 * storage driver does — someone has to delete this file to deploy it. It sits
 * inside the `requireAuth` block rather than in front of it, because a page
 * listing passwords is the last thing that should be the exception to Phase 3's
 * rule. That does mean you need a session to read the credentials; the README
 * is where the first one comes from.
 */

export const DEV_DASHBOARD_PATH = '/dev';

/**
 * Called at boot next to the storage driver, so a build that would serve this
 * in production fails at startup rather than the first time someone loads it.
 */
export function assertDevDashboardAllowed(): void {
  if (isProduction) {
    throw new Error(
      'The developer dashboard prints seeded credentials and must never run in production.',
    );
  }
}

/**
 * Resolved from the working directory rather than from `import.meta.url`,
 * because `pnpm dev` and Vitest both run with the cwd at `apps/server` and this
 * never runs from `dist/`.
 */
const SERVER_ROOT = process.cwd();
const REPO_ROOT = path.resolve(SERVER_ROOT, '../..');

interface CoverageTarget {
  key: string;
  label: string;
  dir: string;
  /** Why this package's number means what it means — see the README. */
  caveat?: string;
}

const COVERAGE_TARGETS: CoverageTarget[] = [
  { key: 'server', label: 'apps/server', dir: path.join(SERVER_ROOT, 'coverage') },
  {
    key: 'client',
    label: 'apps/client',
    dir: path.join(REPO_ROOT, 'apps/client/coverage'),
    caveat: 'Counts a component only where a test renders it.',
  },
  {
    key: 'shared',
    label: 'packages/shared',
    dir: path.join(REPO_ROOT, 'packages/shared/coverage'),
    caveat:
      'Reads low by construction — schemas exercised by both apps, imported by few tests here.',
  },
];

interface CoverageMetric {
  total: number;
  covered: number;
  pct: number;
}

interface CoverageSummary {
  total: Record<'lines' | 'statements' | 'functions' | 'branches', CoverageMetric>;
}

async function readCoverage(target: CoverageTarget): Promise<CoverageSummary | null> {
  try {
    const raw = await readFile(path.join(target.dir, 'coverage-summary.json'), 'utf8');
    return JSON.parse(raw) as CoverageSummary;
  } catch {
    // Not generated yet is the normal state on a fresh clone, not an error.
    return null;
  }
}

/** Everything rendered below is either from the database or from disk. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pctClass(pct: number): string {
  if (pct >= 90) return 'good';
  if (pct >= 70) return 'ok';
  return 'low';
}

function coverageRow(target: CoverageTarget, summary: CoverageSummary | null): string {
  if (!summary) {
    return `<tr>
      <td><code>${escapeHtml(target.label)}</code></td>
      <td colspan="4" class="muted">Not generated — run <code>pnpm test:coverage</code></td>
      <td></td>
    </tr>`;
  }

  const cell = (metric: CoverageMetric) =>
    `<td class="num ${pctClass(metric.pct)}">${metric.pct.toFixed(1)}%<span class="sub">${metric.covered}/${metric.total}</span></td>`;

  return `<tr>
    <td>
      <code>${escapeHtml(target.label)}</code>
      ${target.caveat ? `<div class="muted sub">${escapeHtml(target.caveat)}</div>` : ''}
    </td>
    ${cell(summary.total.statements)}
    ${cell(summary.total.branches)}
    ${cell(summary.total.functions)}
    ${cell(summary.total.lines)}
    <td><a href="/api/dev/coverage/${target.key}/">Full report →</a></td>
  </tr>`;
}

const STYLES = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 2.5rem 1.5rem 4rem; font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         color: #0f172a; background: #f8fafc; }
  main { max-width: 60rem; margin: 0 auto; }
  h1 { font-size: 1.35rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
  h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; color: #64748b;
       margin: 2.25rem 0 .75rem; font-weight: 600; }
  p { margin: .4rem 0; }
  a { color: #1d4ed8; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .86em;
         background: #eef2f7; padding: .1em .35em; border-radius: 4px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: .72rem; text-transform: uppercase; letter-spacing: .05em;
       color: #64748b; padding: .6rem .85rem; border-bottom: 1px solid #e2e8f0; font-weight: 600; }
  td { padding: .65rem .85rem; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .good { color: #15803d; } .ok { color: #a16207; } .low { color: #b91c1c; }
  .sub { display: block; font-size: .75rem; color: #94a3b8; font-weight: 400; }
  .muted { color: #64748b; }
  .pill { display: inline-block; font-size: .7rem; padding: .1rem .45rem; border-radius: 999px;
          background: #e2e8f0; color: #475569; vertical-align: middle; }
  .links { display: flex; flex-wrap: wrap; gap: .5rem; }
  .links a { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: .5rem .8rem;
             text-decoration: none; font-size: .9rem; }
  .links a:hover { border-color: #94a3b8; }
  .warn { background: #fffbeb; border: 1px solid #fde68a; color: #78350f; border-radius: 8px;
          padding: .7rem .85rem; font-size: .87rem; }
  @media (prefers-color-scheme: dark) {
    body { color: #e2e8f0; background: #0b1120; }
    h1 { color: #f1f5f9; }
    .card, .links a { background: #111a2e; border-color: #1e293b; }
    td { border-bottom-color: #16213a; } th { border-bottom-color: #1e293b; }
    code { background: #1e293b; } a { color: #93c5fd; }
    .good { color: #4ade80; } .ok { color: #fbbf24; } .low { color: #f87171; }
    .pill { background: #1e293b; color: #cbd5e1; }
    .warn { background: #2a2109; border-color: #713f12; color: #fde68a; }
  }
`;

export const devRouter: Router = Router();

/** The vitest HTML reports, served so the links above actually resolve. */
for (const target of COVERAGE_TARGETS) {
  devRouter.use(
    `${DEV_DASHBOARD_PATH}/coverage/${target.key}`,
    // `fallthrough` so a missing report 404s through the normal handler rather
    // than dead-ending, and no directory listing.
    express.static(target.dir, { fallthrough: true, index: 'index.html', redirect: true }),
  );
}

devRouter.get(DEV_DASHBOARD_PATH, async (req, res) => {
  const me = currentUser(req);

  const [users, coverage] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, email: true, role: true, isActive: true },
    }),
    Promise.all(COVERAGE_TARGETS.map(async (t) => [t, await readCoverage(t)] as const)),
  ]);

  // The bootstrap admin's password comes from `.env` and is a real credential;
  // the seeded agents share a literal that is already printed by `pnpm db:seed`.
  const bootstrapEmail = env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase();

  const userRows = users
    .map((user) => {
      const isBootstrap = user.email.toLowerCase() === bootstrapEmail;
      const password = isBootstrap
        ? '<span class="muted">from <code>BOOTSTRAP_ADMIN_PASSWORD</code> in <code>apps/server/.env</code></span>'
        : `<code>${escapeHtml(SEED_AGENT_PASSWORD)}</code>`;
      return `<tr>
        <td>${escapeHtml(user.name)}${user.id === me.id ? ' <span class="pill">you</span>' : ''}${
          user.isActive ? '' : ' <span class="pill">deactivated</span>'
        }</td>
        <td><code>${escapeHtml(user.email)}</code></td>
        <td>${escapeHtml(user.role)}</td>
        <td>${password}</td>
      </tr>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Developer dashboard · Support</title>
  <style>${STYLES}</style>
</head>
<body>
  <main>
    <h1>Developer dashboard</h1>
    <p class="muted">
      Support API v${escapeHtml(env.APP_VERSION)} · <code>${escapeHtml(env.NODE_ENV)}</code> ·
      signed in as ${escapeHtml(me.name)} (${escapeHtml(me.role)})
    </p>

    <h2>Sign in as</h2>
    <div class="card">
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Password</th></tr></thead>
        <tbody>${userRows}</tbody>
      </table>
    </div>
    <p class="muted sub" style="margin-top:.6rem">
      Development seed accounts. This page refuses to start when <code>NODE_ENV=production</code>.
    </p>

    <h2>Test coverage</h2>
    <div class="card">
      <table>
        <thead>
          <tr><th>Package</th><th class="num">Stmts</th><th class="num">Branch</th>
              <th class="num">Funcs</th><th class="num">Lines</th><th></th></tr>
        </thead>
        <tbody>${coverage.map(([target, summary]) => coverageRow(target, summary)).join('\n')}</tbody>
      </table>
    </div>
    <p class="muted sub" style="margin-top:.6rem">
      Regenerate with <code>pnpm test:coverage</code>. Reported, not enforced — there is no
      threshold that fails a run.
    </p>

    <h2>Elsewhere</h2>
    <div class="links">
      <a href="/api/docs">Swagger UI</a>
      <a href="/api/openapi.json">OpenAPI document</a>
      <a href="/api/health">Health</a>
      <a href="/tickets">Ticket queue</a>
      <a href="/dashboard">Dashboard</a>
    </div>
    <p class="muted sub" style="margin-top:.75rem">
      App links resolve only through the SPA origin — <code>http://localhost:5173/api/dev</code>.
      On the API port directly there is no SPA to link to.
    </p>
  </main>
</body>
</html>`;

  res.type('html').send(html);
});
