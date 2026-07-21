import { buildApp } from './app/buildApp.js';

const host = process.env.AGENVYL_HOST ?? '127.0.0.1';
const port = Number(process.env.AGENVYL_PORT ?? 8791);
const app = await buildApp();

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await app.close();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
