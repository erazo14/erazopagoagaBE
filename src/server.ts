import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {connectMongoDB} from './db/mongodb';

const app = Fastify({
  logger: true,
});

async function configureApp() {
  await app.register(cors, {
    origin: true,
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Erazo Pagoaga API',
        description: 'Wedding API',
        version: '1.0.0',
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  await connectMongoDB();

  app.get('/ping', async () => {
    return {
      message: 'pong',
    };
  });

  app.get('/db-test', async () => {
    const db = await connectMongoDB();

    const result = await db.command({
      ping: 1,
    });

    return {
      message: 'MongoDB connected',
      ok: result.ok === 1,
    };
  });

  await app.ready();
}

let appReady: Promise<void> | undefined;

function prepareApp(): Promise<void> {
  appReady ??= configureApp();
  return appReady;
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await prepareApp();
  app.server.emit('request', request, response);
}

async function start() {
  await prepareApp();

  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';

  await app.listen({
    port,
    host,
  });
}

if (process.env.VERCEL !== '1') {
  start().catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}
