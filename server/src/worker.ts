import 'dotenv/config';
import { createServer } from 'node:http';
import { asValue } from 'awilix';
import { loadConfigOrExit } from './config/index.js';
import { createContainer } from './container.js';
import { TesseractPool } from './modules/ocr/ocr-pool.js';

const config = loadConfigOrExit();
const container = createContainer(config);
const { logger, workerMetrics } = container.cradle;

const ocr = await TesseractPool.create({
  size: config.OCR_POOL_SIZE,
  tessdataDir: config.TESSDATA_DIR,
});
container.register({ ocrEngine: asValue(ocr) });
logger.info({ pool_size: config.OCR_POOL_SIZE }, 'ocr pool ready');

const runner = container.cradle.jobRunner;
runner.start();

// Processing metrics (histograms) are exposed by each worker on its own port.
const metricsServer =
  config.WORKER_METRICS_PORT > 0
    ? createServer(async (req, res) => {
        if (req.url !== '/metrics') {
          res.writeHead(404).end();
          return;
        }
        res.setHeader('Content-Type', workerMetrics.registry.contentType);
        res.end(await workerMetrics.registry.metrics());
      }).listen(config.WORKER_METRICS_PORT)
    : null;

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'worker shutting down');
  setTimeout(() => process.exit(1), 30_000).unref();
  await runner.stop();
  metricsServer?.close();
  await ocr.terminate();
  await container.dispose();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
