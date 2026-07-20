import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export async function registerStaticFrontend(app: FastifyInstance, distPath: string) {
  const root = resolve(distPath);
  if (!existsSync(root)) return;

  await app.register(fastifyStatic, { root, wildcard: false });
  app.setNotFoundHandler((request, reply) =>
    request.url.startsWith('/api/')
      ? reply.code(404).send({ error: 'not_found' })
      : reply.sendFile('index.html'),
  );
}
