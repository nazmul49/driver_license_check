import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfigOrExit } from './config/index.js';
import { createContainer } from './container.js';

const config = loadConfigOrExit();
const container = createContainer(config);
const app = createApp(container);

const server = app.listen(config.PORT, () => {
  container.cradle.logger.info({ port: config.PORT }, 'api listening');
});

const shutdown = (signal: string) => {
  container.cradle.logger.info({ signal }, 'api shutting down');
  server.close(() => {
    void container.dispose().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
