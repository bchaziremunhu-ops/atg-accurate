import http from 'node:http';
import os from 'node:os';
import { createApp } from './app.js';
import { env, integrations, assertProductionEnv } from './config/env.js';
import { initRealtime, setIo } from './realtime/socket.js';
import { startSubscriptionJobs } from './jobs/subscriptionExpiry.js';
import { prisma } from './lib/prisma.js';

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

function clientPort(): number {
  try {
    return Number(new URL(env.publicUrl).port) || 5273;
  } catch {
    return 5273;
  }
}

async function main() {
  assertProductionEnv();

  const app = createApp();
  const server = http.createServer(app);
  const io = initRealtime(server);
  setIo(io);

  startSubscriptionJobs();

  const servingClient = app.get('servingClient') === true;

  server.listen(env.port, env.host, () => {
    console.log(`\n  ATG Traders API  →  http://localhost:${env.port}/api`);
    if (servingClient) {
      console.log(`  ATG Traders web  →  http://localhost:${env.port}`);
      console.log(`  Public URL       →  ${env.publicUrl}`);
    } else {
      console.log(`  ATG Traders web  →  http://localhost:${clientPort()}`);
      const lan = lanAddresses();
      if (lan.length) {
        console.log(`  On your network  →  ${lan.map((ip) => `http://${ip}:${clientPort()}`).join('  ')}`);
        console.log(`  (share that link with phones/tablets on the same Wi-Fi)`);
      }
    }
    console.log(`  Env: ${env.nodeEnv}`);
    console.log(
      `  Integrations: stripe=${integrations.stripe} webhook=${integrations.stripeWebhook} webPush=${integrations.webPush} fcm=${integrations.fcm} payments=${integrations.payments} marketData=${integrations.marketData}\n`,
    );
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[fatal] unhandledRejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[fatal] uncaughtException:', err);
    process.exit(1);
  });

  const shutdown = async () => {
    console.log('\nShutting down...');
    io.close();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
