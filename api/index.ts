import {main} from '../dist';

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

  return app.restServer.requestHandler(req, res);
}