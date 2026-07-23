import { buildApp } from './app/buildApp.js';
import {buildPreviewApp} from './app/buildPreviewApp.js';

const host = process.env.AGENVYL_HOST ?? '127.0.0.1';
const port = Number(process.env.AGENVYL_PORT ?? 8791);
const previewHost=process.env.AGENVYL_PREVIEW_HOST??host;
const previewPort=Number(process.env.AGENVYL_PREVIEW_PORT??8792);
const previewOrigin=process.env.AGENVYL_PREVIEW_ORIGIN??`http://127.0.0.1:${previewPort}`;
const app = await buildApp({previewOrigin});
const previewApp=await buildPreviewApp({upstreamOrigin:`http://127.0.0.1:${port}`});

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await Promise.all([previewApp.close(),app.close()]);
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

try {
  await app.listen({ host, port });
  await previewApp.listen({host:previewHost,port:previewPort});
} catch (error) {
  app.log.error(error);
  await Promise.allSettled([previewApp.close(),app.close()]);
  process.exit(1);
}
