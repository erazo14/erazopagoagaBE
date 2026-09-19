import {main} from '../dist/index.js';

let appPromise: ReturnType<typeof main> | undefined;

export default async function handler(req: any, res: any) {
  if (!appPromise) {
    appPromise = main(
      {
        rest: {
          port: 3000,
          host: '0.0.0.0',
          openApiSpec: {
            setServersFromRequest: true,
          },
        },
      },
      false,
    );
  }

  const app = await appPromise;

  const rawPath = req.query?.['...path'];

  let cleanPath = '/';

  if (Array.isArray(rawPath)) {
    cleanPath = '/' + rawPath.join('/');
  } else if (typeof rawPath === 'string') {
    cleanPath = '/' + rawPath;
  }

  req.url = cleanPath;

  return app.restServer.requestHandler(req, res);
}