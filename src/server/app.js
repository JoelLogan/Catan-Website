import path from 'node:path';
import express from 'express';
import helmet from 'helmet';

/**
 * HTTP application. Only the `public/` and `shared/` directories are served;
 * server code, data files and configuration are never reachable over HTTP.
 */
export function createApp({ config, logger, stats }) {
    const app = express();
    app.disable('x-powered-by');
    if (config.trustProxy) app.set('trust proxy', config.trustProxy);

    app.use(
        helmet({
            contentSecurityPolicy: {
                useDefaults: false,
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'"],
                    styleSrc: ["'self'", 'https://fonts.googleapis.com'],
                    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
                    imgSrc: ["'self'", 'data:'],
                    connectSrc: ["'self'"],
                    objectSrc: ["'none'"],
                    baseUri: ["'self'"],
                    formAction: ["'self'"],
                    frameAncestors: ["'none'"],
                    ...(config.production ? { upgradeInsecureRequests: [] } : {}),
                },
            },
            crossOriginEmbedderPolicy: false,
            hsts: config.production,
        }),
    );

    app.get('/healthz', (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, uptime: Math.round(process.uptime()), ...stats() });
    });

    const staticOpts = {
        index: false,
        dotfiles: 'ignore',
        maxAge: config.production ? '1h' : 0,
        setHeaders(res, file) {
            if (file.endsWith('.html')) res.set('Cache-Control', 'no-cache');
        },
    };
    app.use('/shared', express.static(path.join(config.root, 'shared'), staticOpts));
    app.use(express.static(path.join(config.root, 'public'), staticOpts));

    app.get('/', (req, res) => {
        res.set('Cache-Control', 'no-cache');
        res.sendFile(path.join(config.root, 'public', 'index.html'));
    });

    app.use((req, res) => {
        res.status(404).type('text/plain').send('Not found');
    });

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        logger.error('HTTP error', err);
        res.status(500).type('text/plain').send('Internal server error');
    });

    return app;
}
