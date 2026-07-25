import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from '../openapi/document.js';

/**
 * Swagger UI for manually exercising the API in development.
 *
 * Mounted only when `ENABLE_API_DOCS` is on, which defaults to off in
 * production. The PRD allows no public unauthenticated routes, and an
 * interactive console over customer data is exactly the thing not to expose —
 * so shipping it needs a deliberate environment change, not an oversight.
 */
export const docsRouter: Router = Router();

docsRouter.get('/openapi.json', (_req, res) => {
  res.json(openApiDocument());
});

docsRouter.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(openApiDocument(), {
    customSiteTitle: 'Support API',
    swaggerOptions: {
      displayRequestDuration: true,
      // The queue view is the interesting one; collapse the rest by default.
      docExpansion: 'list',
      persistAuthorization: true,
    },
  }),
);
