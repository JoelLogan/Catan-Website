/** An error caused by an invalid player action. Its message is safe to show to users. */
export class GameError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GameError';
    }
}

export function assert(condition, message) {
    if (!condition) throw new GameError(message);
}
