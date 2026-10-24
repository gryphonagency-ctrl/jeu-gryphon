const { TikTokLiveConnection } = require('tiktok-live-connector');
const WebSocket = require('ws');

const tiktokUsername = (process.env.TIKTOK_USERNAME || 'gryphon.agency').trim().replace(/^@/, '');
const wsUrl = process.env.WS_URL || 'wss://jeu6boite.onrender.com';
const tiktokLiveConnection = new TikTokLiveConnection(tiktokUsername, {});
let ws;
let reconnectTimer;
let tiktokConnected = false;
const avatarCache = new Map();
const avatarLookupTimes = new Map();
const MAX_AVATAR_BYTES = 512 * 1024;
const processedGiftMessageIds = new Set();

function getTikTokGiftImageUrl(gift) {
    const candidates = [
        gift.giftImageUrl,
        gift.giftPictureUrl,
        gift.imageUrl,
        gift.giftDetails?.giftPictureUrl,
        gift.giftDetails?.giftImageUrl,
        gift.giftDetails?.giftImage?.urlList,
        gift.giftDetails?.giftImage?.url_list,
        gift.giftDetails?.image?.urlList,
        gift.giftDetails?.image?.url_list,
        gift.gift?.giftPictureUrl,
        gift.gift?.giftImage?.urlList,
        gift.gift?.giftImage?.url_list,
        gift.gift?.imageUrl,
        gift.gift?.image?.urlList,
        gift.gift?.image?.url_list,
        gift.giftImage?.urlList,
        gift.giftImage?.url_list,
        gift.image?.urlList,
        gift.image?.url_list
    ];
    for (const value of candidates.flat(Infinity)) {
        if (typeof value !== 'string' || value.length > 2048) continue;
        try {
            const url = new URL(value);
            if (url.protocol === 'https:') return url.href;
        } catch {
            continue;
        }
    }
    return '';
}

function connectWebSocket() {
    ws = new WebSocket(wsUrl);

    ws.on('message', handleGameMessage);
    ws.on('open', () => console.info(`WebSocket connecté : ${wsUrl}`));
    ws.on('error', error => console.error('Erreur WebSocket :', error.message));
    ws.on('close', () => {
        console.warn('WebSocket fermé. Nouvelle tentative dans 3 secondes.');
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectWebSocket, 3000);
    });
}

function sendToGame(message) {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    } else {
        console.warn('Message ignoré : WebSocket non connecté.');
    }
}

function handleGameMessage(message) {
    try {
        const request = JSON.parse(message.toString());
        if (request.action !== 'CONNECT_TIKTOK') return;

        const requestedUsername = String(request.username || '').trim().replace(/^@/, '');
        if (requestedUsername.toLocaleLowerCase() !== tiktokUsername.toLocaleLowerCase()) {
            sendToGame({
                type: 'STATUS',
                message: `Erreur : le connecteur est configuré pour @${tiktokUsername}.`
            });
            return;
        }

        sendToGame({
            type: 'STATUS',
            message: tiktokConnected
                ? `Direct TikTok connecté · @${tiktokUsername}`
                : `Connexion TikTok en cours · @${tiktokUsername}`
        });
    } catch (error) {
        console.warn('Message reçu du jeu invalide :', error.message);
    }
}

function getAvatarUrls(user) {
    const avatarCandidates = [
        user?.avatarLarge,
        user?.avatarMedium,
        user?.avatarThumb,
        user?.profilePictureUrl,
        user?.profilePictureUrls,
        user?.profilePicture,
        user?.userDetails?.profilePictureUrls
    ];
    const avatarUrls = avatarCandidates.flatMap(avatar => {
        if (typeof avatar === 'string') return [avatar];
        if (Array.isArray(avatar)) return avatar;
        if (!avatar || typeof avatar !== 'object') return [];
        const urls = avatar.urlList ?? avatar.url_list;
        return [
            ...(Array.isArray(urls) ? urls : []),
            avatar.url,
            avatar.profilePictureUrl
        ];
    });

    return [...new Set(avatarUrls.filter(url =>
        typeof url === 'string' && /^https?:\/\//i.test(url)
    ))];
}

async function fetchAvatarData(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) return null;

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_AVATAR_BYTES) {
        return null;
    }

    const image = Buffer.from(await response.arrayBuffer());
    if (!image.length || image.length > MAX_AVATAR_BYTES) return null;
    return `data:${contentType.split(';', 1)[0]};base64,${image.toString('base64')}`;
}

async function getAvatarData(user) {
    const avatarUrls = getAvatarUrls(user);
    try {
        const avatarDataUri = await Promise.any(avatarUrls.map(async url => {
            if (!avatarCache.has(url)) {
                avatarCache.set(url, fetchAvatarData(url));
                if (avatarCache.size > 500) {
                    avatarCache.delete(avatarCache.keys().next().value);
                }
            }
            try {
                const image = await avatarCache.get(url);
                if (!image) throw new Error('Réponse image invalide.');
                return image;
            } catch (error) {
                avatarCache.delete(url);
                throw error;
            }
        }));
        return { avatarDataUri, avatarUrls };
    } catch (error) {
        console.warn('Impossible de récupérer les photos de profil TikTok.');
        return { avatarDataUri: null, avatarUrls };
    }
}

tiktokLiveConnection.on('gift', async gift => {
    const giftType = Number(
        gift.giftDetails?.giftType ??
        gift.giftType ??
        gift.gift?.gift_type ??
        gift.gift?.giftType ??
        gift.gift?.type
    );
    const repeatEnd =
        gift.repeatEnd === true ||
        Number(gift.repeatEnd ?? gift.gift?.repeat_end ?? gift.gift?.repeatEnd) === 1;
    if (giftType === 1 && !repeatEnd) {
        console.info(
            `Série en cours ignorée : ${gift.gift?.name || 'cadeau'} ` +
            `(répétitions=${gift.repeatCount || 1}, en attente de la fin).`
        );
        return;
    }

    const coinValue = Number(
        gift.coinValue ??
        gift.diamondCount ??
        gift.giftDetails?.diamondCount ??
        gift.gift?.diamondCount ??
        gift.extendedGiftInfo?.diamondCount
    );
    const repeatCount = Math.max(
        1,
        Math.floor(Number(gift.repeatCount ?? gift.gift?.repeat_count ?? gift.gift?.repeatCount) || 1)
    );
    const appliedRepeatCount = giftType === 1 ? repeatCount : 1;
    const coinCount = Math.floor(coinValue * appliedRepeatCount);
    if (!Number.isSafeInteger(coinCount) || coinCount < 1) {
        console.warn(
            `Cadeau ignoré : valeur en diamants invalide ` +
            `(diamants=${gift.gift?.diamondCount}, répétitions=${gift.repeatCount}).`
        );
        return;
    }

    const messageId = String(gift.common?.msgId ?? '');
    if (messageId && processedGiftMessageIds.has(messageId)) {
        console.warn(`Événement cadeau dupliqué ignoré (${messageId}).`);
        return;
    }
    if (messageId) {
        processedGiftMessageIds.add(messageId);
        if (processedGiftMessageIds.size > 5000) {
            processedGiftMessageIds.delete(processedGiftMessageIds.values().next().value);
        }
    }

    const { avatarDataUri, avatarUrls } = await getAvatarData(gift.user);
    sendToGame({
        type: 'gift',
        gift: {
            messageId,
            username: gift.user?.displayId || gift.user?.nickname || '',
            nickname: gift.user?.nickname || '',
            avatarDataUri,
            avatarUrls,
            coinValue,
            giftType,
            repeatCount: appliedRepeatCount,
            coinCount,
            giftName: gift.gift?.name || '',
            giftImageUrl: getTikTokGiftImageUrl(gift)
        }
    });

    console.info(
        `Cadeau reçu de ${gift.user?.displayId || gift.user?.nickname || 'inconnu'} ` +
        `(${coinValue} diamant(s) × ${appliedRepeatCount} = ${coinCount} pièce(s), photo : ` +
        `${avatarDataUri ? 'intégrée' : avatarUrls.length ? 'URL de secours' : 'absente'})`
    );
});

tiktokLiveConnection.on('chat', message => {
    const username = message.user?.displayId || message.user?.nickname || '';
    sendToGame({
        type: 'comment',
        commentData: {
            username,
            comment: message.content || ''
        }
    });

    const viewerKey = String(message.user?.uniqueId || username).toLocaleLowerCase();
    const lastLookup = avatarLookupTimes.get(viewerKey) || 0;
    if (!viewerKey || Date.now() - lastLookup < 60000) return;
    avatarLookupTimes.set(viewerKey, Date.now());
    if (avatarLookupTimes.size > 500) {
        avatarLookupTimes.delete(avatarLookupTimes.keys().next().value);
    }

    getAvatarData(message.user)
        .then(({ avatarDataUri }) => {
            if (avatarDataUri) {
                sendToGame({
                    type: 'viewer',
                    viewer: { username, avatarDataUri }
                });
            }
        })
        .catch(error => console.warn(`Impossible de charger l’avatar TikTok de ${username || 'un spectateur'} :`, error));
});

tiktokLiveConnection.on('like', message => {
    const likeCount = Math.floor(Number(message.likeCount) || 0);
    if (likeCount < 1) return;

    sendToGame({
        type: 'like',
        likeData: {
            username: message.user?.uniqueId || message.user?.nickname || '',
            nickname: message.user?.nickname || '',
            likeCount
        }
    });
});

connectWebSocket();

tiktokLiveConnection.on('disconnected', () => {
    tiktokConnected = false;
    sendToGame({ type: 'STATUS', message: `Connexion TikTok interrompue · @${tiktokUsername}` });
});

tiktokLiveConnection.connect()
    .then(state => {
        tiktokConnected = true;
        console.info(`Connecté au live TikTok. Room ID : ${state.roomId}`);
        sendToGame({ type: 'STATUS', message: `Direct TikTok connecté · @${tiktokUsername}` });
    })
    .catch(error => {
        tiktokConnected = false;
        console.error('Erreur de connexion TikTok :', error);
        sendToGame({ type: 'STATUS', message: `Erreur de connexion TikTok · @${tiktokUsername}` });
    });