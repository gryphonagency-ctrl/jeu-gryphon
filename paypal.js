const crypto = require('crypto');
const store = require('./account-store');
const access = require('./access-control');

const offers = {
    mensuel: {
        name: 'Mensuel',
        price: '7.50',
        interval: 'MONTH'
    },
    annuel: {
        name: 'Annuelle',
        price: '83.00',
        interval: 'YEAR'
    }
};
const PRICE_VERSION = 'gryphon-prices-2026-10-v5';
const checkoutAttempts = new Map();
const CHECKOUT_LIMIT = 5;
const CHECKOUT_WINDOW_MS = 15 * 60 * 1000;

let cachedToken = '';
let cachedTokenExpiresAt = 0;
let cachedTokenKey = '';
let plansPromise = null;

function getConfiguration() {
    const mode = process.env.PAYPAL_MODE || 'sandbox';
    if (mode !== 'sandbox' && mode !== 'live') {
        throw new Error('PAYPAL_MODE must be either "sandbox" or "live".');
    }
    return {
        mode,
        clientId: process.env.PAYPAL_CLIENT_ID || '',
        clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
        webhookId: process.env.PAYPAL_WEBHOOK_ID || '',
        baseUrl: mode === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com'
    };
}

async function getAccessToken(configuration) {
    const tokenKey = `${configuration.mode}:${configuration.clientId}`;
    if (cachedToken && cachedTokenKey === tokenKey &&
        cachedTokenExpiresAt > Date.now() + 30_000) return cachedToken;
    const credentials = Buffer.from(
        `${configuration.clientId}:${configuration.clientSecret}`
    ).toString('base64');
    const response = await fetch(`${configuration.baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(15_000)
    });
    const result = await response.json();
    if (!response.ok || !result.access_token) {
        throw new Error(`PayPal authentication failed (${response.status}).`);
    }
    cachedToken = result.access_token;
    cachedTokenKey = tokenKey;
    cachedTokenExpiresAt = Date.now() + Number(result.expires_in || 300) * 1000;
    return cachedToken;
}

async function paypalRequest(configuration, url, options = {}) {
    const token = await getAccessToken(configuration);
    const response = await fetch(`${configuration.baseUrl}${url}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        signal: AbortSignal.timeout(15_000)
    });
    let result = {};
    try {
        result = await response.json();
    } catch {
        if (response.ok) throw new Error('PayPal returned an invalid response.');
    }
    if (!response.ok) {
        console.error(`PayPal API request failed (${response.status}):`, result.name || result.message || 'Unknown error');
        throw new Error(`La requête PayPal a échoué (HTTP ${response.status}).`);
    }
    return result;
}

function requestId(value) {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function credentialsConfigured(configuration) {
    return Boolean(configuration.clientId && configuration.clientSecret);
}

function paymentsConfigured(configuration) {
    return credentialsConfigured(configuration) && Boolean(configuration.webhookId);
}

async function ensurePlans(configuration) {
    const existingPlans = store.getPlans(configuration.mode);
    if (existingPlans && existingPlans.priceVersion === PRICE_VERSION &&
        Object.keys(offers).every(key => existingPlans[key])) return existingPlans;
    if (plansPromise) return plansPromise;

    plansPromise = (async () => {
        const product = await paypalRequest(configuration, '/v1/catalogs/products', {
            method: 'POST',
            headers: {
                'PayPal-Request-Id': requestId(`${PRICE_VERSION}:${configuration.mode}:product`)
            },
            body: JSON.stringify({
                name: 'GRYPHON ARCADE',
                description: 'Abonnements d’accès à la vitrine de jeux GRYPHON ARCADE.',
                type: 'SERVICE',
                category: 'SOFTWARE'
            })
        });
        const plans = { mode: configuration.mode, priceVersion: PRICE_VERSION, productId: product.id };
        for (const [key, offer] of Object.entries(offers)) {
            const plan = await paypalRequest(configuration, '/v1/billing/plans', {
                method: 'POST',
                headers: {
                    'PayPal-Request-Id': requestId(`${PRICE_VERSION}:${configuration.mode}:${key}`)
                },
                body: JSON.stringify({
                    product_id: product.id,
                    name: `${offer.name} — GRYPHON ARCADE`,
                    description: `Accès ${offer.name} à GRYPHON ARCADE.`,
                    billing_cycles: [{
                        frequency: {
                            interval_unit: offer.interval,
                            interval_count: 1
                        },
                        tenure_type: 'REGULAR',
                        sequence: 1,
                        total_cycles: 0,
                        pricing_scheme: {
                            fixed_price: { value: offer.price, currency_code: 'EUR' }
                        }
                    }],
                    payment_preferences: {
                        auto_bill_outstanding: true,
                        setup_fee_failure_action: 'CANCEL',
                        payment_failure_threshold: 1
                    }
                })
            });
            plans[key] = plan.id;
        }
        store.savePlans(plans);
        return plans;
    })();

    try {
        return await plansPromise;
    } finally {
        plansPromise = null;
    }
}

async function getPublicConfiguration() {
    const configuration = getConfiguration();
    if (!paymentsConfigured(configuration)) {
        return {
            configured: false,
            mode: configuration.mode,
            message: credentialsConfigured(configuration)
                ? 'Configure aussi le webhook PayPal pour activer et suspendre les accès automatiquement.'
                : 'Les paiements PayPal ne sont pas encore configurés sur le serveur.'
        };
    }
    const plans = await ensurePlans(configuration);
    return {
        configured: true,
        clientId: configuration.clientId,
        mode: configuration.mode,
        plans: Object.fromEntries(Object.keys(offers).map(key => [key, plans[key]]))
    };
}

async function createCheckout(username, password, planKey, req) {
    const configuration = getConfiguration();
    if (!paymentsConfigured(configuration)) {
        throw new Error('Configure PayPal et son webhook avant d’ouvrir les paiements.');
    }
    if (!Object.hasOwn(offers, planKey)) throw new Error('Formule inconnue.');
    const forwardedAddresses = req.headers['x-forwarded-for'];
    const clientKey = typeof forwardedAddresses === 'string'
        ? forwardedAddresses.split(',').pop().trim()
        : req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempts = checkoutAttempts.get(clientKey);
    if (attempts && attempts.expiresAt > now && attempts.count >= CHECKOUT_LIMIT) {
        throw new Error('Trop de tentatives. Réessaie dans quinze minutes.');
    }
    checkoutAttempts.set(clientKey, {
        count: attempts && attempts.expiresAt > now ? attempts.count + 1 : 1,
        expiresAt: attempts && attempts.expiresAt > now
            ? attempts.expiresAt
            : now + CHECKOUT_WINDOW_MS
    });

    const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
    if (!/^[a-zA-Z0-9._@-]{1,64}$/.test(normalizedUsername)) {
        throw new Error('Choisis un identifiant de 1 à 64 caractères (lettres, chiffres, ., _, @ ou -).');
    }
    if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
        throw new Error('Le mot de passe doit contenir entre 12 et 256 caractères.');
    }
    if (store.getAccount(normalizedUsername) || access.hasConfiguredUser(normalizedUsername)) {
        throw new Error('Cet identifiant existe déjà. Connecte-toi ou choisis-en un autre.');
    }

    const plans = await ensurePlans(configuration);
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
    const checkoutId = crypto.randomBytes(24).toString('hex');
    const reserved = store.reserveCheckout(checkoutId, {
        username: normalizedUsername,
        salt,
        passwordHash,
        plan: planKey,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
    });
    if (!reserved) throw new Error('Cet identifiant est déjà en cours d’inscription. Choisis-en un autre.');
    return { checkoutId, planId: plans[planKey] };
}

async function confirmSubscription(subscriptionId, checkoutId, password, req, res) {
    if (typeof subscriptionId !== 'string' || !/^[A-Z0-9-]{8,64}$/i.test(subscriptionId)) {
        return { success: false, status: 400, message: 'Référence PayPal invalide.' };
    }
    const checkout = store.getCheckout(checkoutId);
    if (!checkout || checkout.expiresAt <= Date.now()) {
        const existingAccount = store.getAccountBySubscription(subscriptionId);
        if (existingAccount && typeof password === 'string') {
            const loginResult = access.login(existingAccount[0], password, req, res);
            if (loginResult.success) {
                return { success: true, status: 200, message: 'Paiement confirmé : ton compte est prêt.' };
            }
        }
        if (checkout) store.deleteCheckout(checkoutId);
        return { success: false, status: 400, message: 'Cette session de paiement a expiré. Recommence.' };
    }
    if (typeof password !== 'string' || password.length < 12 || password.length > 256 ||
        !crypto.timingSafeEqual(
            Buffer.from(crypto.scryptSync(password, checkout.salt, 64)),
            Buffer.from(checkout.passwordHash, 'hex')
        )) {
        return { success: false, status: 400, message: 'Les informations du compte ne correspondent pas.' };
    }

    const configuration = getConfiguration();
    const plans = await ensurePlans(configuration);
    const subscription = await paypalRequest(
        configuration,
        `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`
    );
    if (subscription.custom_id !== checkoutId ||
        subscription.plan_id !== plans[checkout.plan] ||
        subscription.status !== 'ACTIVE') {
        return { success: false, status: 402, message: 'PayPal n’a pas encore confirmé cet abonnement.' };
    }
    if (store.getAccount(checkout.username) || access.hasConfiguredUser(checkout.username)) {
        store.deleteCheckout(checkoutId);
        return { success: false, status: 409, message: 'Cet identifiant vient d’être utilisé. Contacte l’administrateur.' };
    }

    store.saveAccount(checkout.username, {
        salt: checkout.salt,
        passwordHash: checkout.passwordHash,
        subscriptionId,
        plan: checkout.plan,
        status: 'ACTIVE',
        createdAt: new Date().toISOString()
    });
    store.deleteCheckout(checkoutId);
    const loginResult = access.login(checkout.username, password, req, res);
    return loginResult.success
        ? { success: true, status: 200, message: 'Paiement confirmé : ton compte est prêt.' }
        : { success: false, status: 500, message: 'Paiement confirmé, mais la session n’a pas pu démarrer. Reconnecte-toi.' };
}

async function verifyWebhook(event, headers) {
    const configuration = getConfiguration();
    if (!credentialsConfigured(configuration) || !configuration.webhookId) {
        throw new Error('PAYPAL_WEBHOOK_ID is not configured.');
    }
    const verification = await paypalRequest(configuration, '/v1/notifications/verify-webhook-signature', {
        method: 'POST',
        body: JSON.stringify({
            auth_algo: headers['paypal-auth-algo'],
            cert_url: headers['paypal-cert-url'],
            transmission_id: headers['paypal-transmission-id'],
            transmission_sig: headers['paypal-transmission-sig'],
            transmission_time: headers['paypal-transmission-time'],
            webhook_id: configuration.webhookId,
            webhook_event: event
        })
    });
    if (verification.verification_status !== 'SUCCESS') {
        throw new Error('PayPal webhook signature verification failed.');
    }

    const eventToStatus = {
        'BILLING.SUBSCRIPTION.ACTIVATED': 'ACTIVE',
        'BILLING.SUBSCRIPTION.CANCELLED': 'CANCELLED',
        'BILLING.SUBSCRIPTION.EXPIRED': 'EXPIRED',
        'BILLING.SUBSCRIPTION.SUSPENDED': 'SUSPENDED',
        'BILLING.SUBSCRIPTION.PAYMENT.FAILED': 'PAYMENT_FAILED'
    };
    const eventStatus = eventToStatus[event.event_type];
    if (!eventStatus) return { received: true, updated: false };

    const resource = event.resource || {};
    const subscriptionId = resource.billing_agreement_id || resource.id;
    if (!subscriptionId) throw new Error('PayPal webhook did not include a subscription ID.');
    const subscription = await paypalRequest(
        configuration,
        `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`
    );
    const statusByPayPalState = {
        ACTIVE: 'ACTIVE',
        CANCELLED: 'CANCELLED',
        EXPIRED: 'EXPIRED',
        SUSPENDED: 'SUSPENDED'
    };
    const status = statusByPayPalState[subscription.status];
    if (!status) return { received: true, updated: false };

    if (status === 'ACTIVE') {
        const checkout = store.getCheckout(subscription.custom_id);
        const plans = await ensurePlans(configuration);
        if (checkout && subscription.plan_id === plans[checkout.plan]) {
            store.saveAccount(checkout.username, {
                salt: checkout.salt,
                passwordHash: checkout.passwordHash,
                subscriptionId,
                plan: checkout.plan,
                status,
                createdAt: new Date().toISOString()
            });
            store.deleteCheckout(subscription.custom_id);
        }
    }
    return { received: true, updated: store.setSubscriptionStatus(subscriptionId, status) };
}

module.exports = {
    confirmSubscription,
    createCheckout,
    getPublicConfiguration,
    verifyWebhook
};
