"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const container_1 = require("./infra/container");
const logger_1 = require("./infra/logger");
let app = null;
async function main() {
    logger_1.logger.info('Starting bot...');
    app = await (0, container_1.buildOrchestrator)();
    await app.start();
    logger_1.logger.info('Application container started');
    const shutdown = async (signal) => {
        logger_1.logger.info({ signal }, 'Shutting down...');
        try {
            await app?.stop();
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error during shutdown');
        }
        finally {
            process.exit(0);
        }
    };
    process.once('SIGINT', () => {
        void shutdown('SIGINT');
    });
    process.once('SIGTERM', () => {
        void shutdown('SIGTERM');
    });
}
main().catch((err) => {
    logger_1.logger.error({ err }, 'Failed to start bot');
    if (app) {
        app
            .stop()
            .catch((stopErr) => logger_1.logger.error({ err: stopErr }, 'Failed to stop app container after crash'))
            .finally(() => process.exit(1));
        return;
    }
    process.exit(1);
});
