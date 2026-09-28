const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function createLogger(level = 'info') {
    const min = LEVELS[level] ?? LEVELS.info;
    const out = (lvl, msg, extra) => {
        if (LEVELS[lvl] < min) return;
        const line = { t: new Date().toISOString(), level: lvl, msg };
        if (extra !== undefined) {
            if (extra instanceof Error) line.err = { message: extra.message, stack: extra.stack };
            else Object.assign(line, extra);
        }
        (lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout).write(`${JSON.stringify(line)}\n`);
    };
    return {
        debug: (m, e) => out('debug', m, e),
        info: (m, e) => out('info', m, e),
        warn: (m, e) => out('warn', m, e),
        error: (m, e) => out('error', m, e),
    };
}
