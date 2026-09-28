import { loadConfig } from './server/config.js';
import { createServer } from './server/index.js';

const config = loadConfig();
const { server, logger, close } = await createServer(config);

server.listen(config.port, config.host, () => {
    logger.info('Catan server listening', { host: config.host, port: config.port, production: config.production });
});

let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
        await close();
        process.exit(0);
    } catch (err) {
        logger.error('Error during shutdown', err);
        process.exit(1);
    }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error('Unhandled rejection', err instanceof Error ? err : { reason: String(err) }));
process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', err);
    shutdown('uncaughtException');
});
