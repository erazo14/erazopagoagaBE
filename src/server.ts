import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import {connectMongoDB} from './db/mongodb';

const app = Fastify({
  logger: true,
});

async function start() {
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

  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';

  await app.listen({
    port,
    host,
  });
}

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
