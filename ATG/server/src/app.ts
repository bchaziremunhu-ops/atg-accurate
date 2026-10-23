import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, corsOrigin, isProduction } from './config/env.js';
import { optionalAuth } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';
import { asyncHandler } from './lib/http.js';
import { authRouter } from './routes/auth.routes.js';
import { userRouter } from './routes/user.routes.js';
import { signalRouter } from './routes/signal.routes.js';
import { courseRouter } from './routes/course.routes.js';
import { communityRouter } from './routes/community.routes.js';
import { walletRouter } from './routes/wallet.routes.js';
import { paymentRouter } from './routes/payment.routes.js';
import { subscriptionRouter } from './routes/subscription.routes.js';
import { purchaseRequestRouter } from './routes/purchaseRequests.routes.js';
import { notificationRouter } from './routes/notification.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { brokerRouter, brokerAdminRouter, brokerWebhookHandler } from './routes/brokerFunding.routes.js';
import { brokerAccountRouter, brokerAccountAdminRouter } from './routes/brokerAccount.routes.js';

export function createApp(): Express {
  const app = express();

  // Behind nginx/cloudflare/etc. set TRUST_PROXY so rate limiting and audit
  // logs see the real client IP instead of the proxy's.
  const trustProxy = env.trustProxy.trim();
  if (trustProxy && trustProxy !== 'false' && trustProxy !== '0') {
    app.set('trust proxy', trustProxy === 'true' ? 1 : Number.isNaN(Number(trustProxy)) ? trustProxy : Number(trustProxy));
  }

  // API responses are always fresh and user-scoped — never serve a 304 from
  // a stale ETag (that can hand a browser an empty/old body).
  app.disable('etag');
  app.set('json spaces', 0);

  app.use(
    helmet({
      // Defaults are already close; only relax what the built SPA needs
      // (Google Fonts) and allow same-origin websockets for Socket.IO.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          fontSrc: ["'self'", 'https:', 'data:'],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          upgradeInsecureRequests: isProduction() ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cors({ origin: corsOrigin(), credentials: true }));
  if (env.nodeEnv !== 'test') app.use(morgan('dev'));

  // Global API rate limit (skipped in tests). Auth gets a much tighter bucket
  // below so password guessing stays expensive.
  const limiter = (max: number) =>
    rateLimit({
      windowMs: env.rateLimitWindowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      skip: () => env.nodeEnv === 'test',
      validate: false,
    });
  app.use('/api', limiter(env.rateLimitMax));

  // Broker funding callbacks also need the raw body for HMAC verification.
  app.post(
    '/api/broker/webhook/:broker',
    express.raw({ type: 'application/json' }),
    asyncHandler(brokerWebhookHandler),
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Resolve the current user (if any) before any route so requireAuth works everywhere.
  app.use(optionalAuth);

  // Account recovery gets the smallest bucket first — it is the only
  // unauthenticated way to change a password.
  app.use('/api/auth/forgot', limiter(env.recoveryRateLimitMax));
  // Keep brute-force protection on credential/session-creation endpoints,
  // not on authenticated session checks that run whenever the app is opened.
  app.use(['/api/auth/login', '/api/auth/register', '/api/auth/refresh'], limiter(env.authRateLimitMax));
  app.use('/api/auth', authRouter);

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
  app.use('/api/users', userRouter);
  app.use('/api/signals', signalRouter);
  app.use('/api/courses', courseRouter);
  app.use('/api/community', communityRouter);
  app.use('/api/wallet', walletRouter);
  app.use('/api/payments', paymentRouter);
  app.use('/api/subscriptions', subscriptionRouter);
  app.use('/api/purchase-requests', purchaseRequestRouter);
  app.use('/api/notifications', notificationRouter);
  app.use('/api/broker', brokerRouter);
  // Weltrade account registration (client id + admin verification).
  app.use('/api/weltrade-account', brokerAccountRouter);
  // Must be registered before /api/admin so the prefix does not swallow it.
  app.use('/api/admin/broker', brokerAdminRouter);
  app.use('/api/admin/weltrade-accounts', brokerAccountAdminRouter);
  app.use('/api/admin', adminRouter);

  // ---- Production single-origin mode -------------------------------------
  // Serves the built client (client/dist) from this same server, so there is
  // no Vite in production and no second origin to secure. `auto` turns it on
  // whenever a build exists; SERVE_CLIENT=true|false forces it either way.
  //
  // The compiled file lives at dist/src/app.js while the source lives at
  // src/app.ts, so the relative hop to ../client/dist differs between the
  // two layouts — probe both (plus CLIENT_DIST) instead of hardcoding one.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const distDir =
    env.clientDistDir ||
    [path.resolve(here, '../../client/dist'), path.resolve(here, '../../../client/dist')].find((p) =>
      fs.existsSync(path.join(p, 'index.html')),
    ) ||
    path.resolve(here, '../../client/dist');
  const indexHtml = path.join(distDir, 'index.html');
  const serveClient = env.serveClient === 'true' || (env.serveClient !== 'false' && fs.existsSync(indexHtml));
  if (serveClient) {
    if (!fs.existsSync(indexHtml)) {
      throw new Error(`SERVE_CLIENT is on but ${indexHtml} is missing — run \`npm run build\` first.`);
    }
    app.use(
      express.static(distDir, {
        index: false,
        maxAge: isProduction() ? '1h' : 0,
        setHeaders: (res, filePath) => {
          // Hashed asset filenames can be cached hard; index.html never is.
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    // SPA fallback: any non-API GET renders the app shell so client routes
    // (/broker-funds, /admin, deep links) work on a hard refresh.
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
    app.set('servingClient', true);
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
