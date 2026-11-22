const PUBLIC_PACHINKO_GAME_ID = '/pachinko-live.html';
const PUBLIC_PACHINKO_RELAY_PATH = '/pachinko-live-relay';
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS_PER_IP = 10;
const MAX_ACTIVE_CONNECTIONS_PER_IP = 2;
const MAX_ACTIVE_CONNECTIONS = 30;
const MAX_TRACKED_IPS = 8192;

function getClientIp(request) {
    const forwardedAddresses = request.headers['x-forwarded-for'];
    if (typeof forwardedAddresses === 'string') {
        const addresses = forwardedAddresses.split(',').map(address => address.trim()).filter(Boolean);
        if (addresses.length) return addresses[addresses.length - 1];
    }
    return request.socket.remoteAddress || 'unknown';
}

function hasSameSecureOrigin(request) {
    const originHeader = request.headers.origin;
    const host = request.headers.host;
    if (typeof originHeader !== 'string' || typeof host !== 'string') return false;

    let origin;
    try {
        origin = new URL(originHeader);
    } catch {
        return false;
    }

    if (origin.origin !== originHeader || origin.host.toLowerCase() !== host.toLowerCase()) return false;
    return origin.protocol === 'https:' ||
        (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname));
}

class PublicPachinkoRelayGate {
    constructor() {
        this.attemptsByIp = new Map();
        this.activeByIp = new Map();
        this.activeConnections = 0;
        this.lastSweepAt = 0;
    }

    acquire(request, requestUrl, now = Date.now()) {
        if (requestUrl.pathname !== PUBLIC_PACHINKO_RELAY_PATH || !hasSameSecureOrigin(request)) {
            return { allowed: false, status: 403 };
        }

        const clientIp = getClientIp(request);
        if (now - this.lastSweepAt >= 60_000 || this.attemptsByIp.size >= MAX_TRACKED_IPS) {
            for (const [ip, attempt] of this.attemptsByIp) {
                if (attempt.resetAt <= now) this.attemptsByIp.delete(ip);
            }
            this.lastSweepAt = now;
        }

        let attempt = this.attemptsByIp.get(clientIp);
        if (!attempt || attempt.resetAt <= now) {
            if (!attempt && this.attemptsByIp.size >= MAX_TRACKED_IPS) {
                return { allowed: false, status: 429 };
            }
            attempt = { count: 0, resetAt: now + ATTEMPT_WINDOW_MS };
            this.attemptsByIp.set(clientIp, attempt);
        }
        if (attempt.count >= MAX_ATTEMPTS_PER_IP) return { allowed: false, status: 429 };
        attempt.count++;

        const activeForIp = this.activeByIp.get(clientIp) || 0;
        if (activeForIp >= MAX_ACTIVE_CONNECTIONS_PER_IP ||
            this.activeConnections >= MAX_ACTIVE_CONNECTIONS) {
            return { allowed: false, status: 429 };
        }

        this.activeByIp.set(clientIp, activeForIp + 1);
        this.activeConnections++;
        let released = false;
        return {
            allowed: true,
            clientIp,
            release: () => {
                if (released) return;
                released = true;
                const current = this.activeByIp.get(clientIp) || 0;
                if (current <= 1) this.activeByIp.delete(clientIp);
                else this.activeByIp.set(clientIp, current - 1);
                this.activeConnections--;
            }
        };
    }
}

module.exports = {
    PUBLIC_PACHINKO_GAME_ID,
    PUBLIC_PACHINKO_RELAY_PATH,
    PublicPachinkoRelayGate
};
