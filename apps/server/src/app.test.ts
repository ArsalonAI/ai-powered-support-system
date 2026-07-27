import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { disconnectPrisma } from './db/prisma.js';

const app = createApp();

afterAll(async () => {
  await disconnectPrisma();
});

describe('GET /api/health', () => {
  it('reports ok when the database is reachable', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      checks: { database: 'ok' },
    });
    expect(response.body.version).toBeTypeOf('string');
  });

  it('echoes a request id for correlation', async () => {
    const response = await request(app).get('/api/health').set('x-request-id', 'test-request-id');

    expect(response.headers['x-request-id']).toBe('test-request-id');
  });
});

describe('error handling', () => {
  it('returns the standard error body for an unknown route', async () => {
    const response = await request(app).get('/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Route not found' });
    expect(response.body.error.requestId).toBeTypeOf('string');
  });

  // Task 3.10 puts `requireAuth` ahead of the not-found handler for `/api/*`,
  // so an unauthenticated caller cannot tell an unknown route from one they are
  // simply not allowed to reach. That is deliberate — see app.ts.
  it('answers 401, not 404, for an unknown API route without a session', async () => {
    const response = await request(app).get('/api/does-not-exist');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed JSON body without leaking a stack trace', async () => {
    const response = await request(app)
      .post('/api/does-not-exist')
      .set('content-type', 'application/json')
      .send('{"broken":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('BAD_REQUEST');
    expect(JSON.stringify(response.body)).not.toContain('at ');
  });
});
