const {main} = require('../dist');

let appPromise;

module.exports = async function handler(req, res) {
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
};