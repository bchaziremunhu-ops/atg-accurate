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
import { adminSiteSettingsRouter, siteSettingsRouter } from './routes/siteSettings.routes.js';

export function createApp(): Express {
  const app = express();

  const trustProxy = env.trustProxy.trim();
  if (trustProxy && trustProxy !== 'false' && trustProxy !== '0') {
    app.set('trust proxy', trustProxy === 'true' ? 1 : Number.isNaN(Number(trustProxy)) ? trustProxy : Number(trustProxy));
  }

  app.disable('etag');
  app.set('json spaces', 0);

  app.use(
    helmet({
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

  app.post(
    '/api/broker/webhook/:broker',
    express.raw({ type: 'application/json' }),
    asyncHandler(brokerWebhookHandler),
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use(optionalAuth);

  app.use('/api/auth/forgot', limiter(env.recoveryRateLimitMax));
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
  app.use('/api/weltrade-account', brokerAccountRouter);
  app.use('/api/site-settings', siteSettingsRouter);
  app.use('/api/admin/site-settings', adminSiteSettingsRouter);
  app.use('/api/admin/broker', brokerAdminRouter);
  app.use('/api/admin/weltrade-accounts', brokerAccountAdminRouter);
  app.use('/api/admin', adminRouter);
  app.use(
    '/uploads/avatars',
    express.static(env.avatarDir, {
      immutable: true,
      maxAge: '1y',
      dotfiles: 'deny',
      index: false,
      setHeaders: (res) => {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    }),
  );
  app.use('/uploads/avatars', (_req, res) => res.sendStatus(404));

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
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
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
