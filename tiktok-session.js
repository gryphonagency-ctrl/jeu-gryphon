const { TikTokLiveConnection } = require('tiktok-live-connector');

const MAX_AVATAR_BYTES = 512 * 1024;

function getAvatarUrls(user) {
    const candidates = [
        user?.avatarLarge,
        user?.avatarMedium,
        user?.avatarThumb,
        user?.profilePictureUrl,
        user?.profilePictureUrls,
        user?.profilePicture,
        user?.userDetails?.profilePictureUrls
    ];
    const urls = candidates.flatMap(avatar => {
        if (typeof avatar === 'string') return [avatar];
        if (Array.isArray(avatar)) return avatar;
        if (!avatar || typeof avatar !== 'object') return [];
        const list = avatar.urlList ?? avatar.url_list;
        return [...(Array.isArray(list) ? list : []), avatar.url, avatar.profilePictureUrl];
    });
    return [...new Set(urls.filter(url =>
        typeof url === 'string' && /^https?:\/\//i.test(url)
    ))];
}

async function getAvatarData(user, cache) {
    const avatarUrls = getAvatarUrls(user);
    try {
        const avatarDataUri = await Promise.any(avatarUrls.map(async url => {
            if (!cache.has(url)) {
                cache.set(url, fetch(url, { signal: AbortSignal.timeout(4000) })
                    .then(async response => {
                        if (!response.ok || !(response.headers.get('content-type') || '')
                            .toLowerCase().startsWith('image/')) return null;
                        const length = Number(response.headers.get('content-length'));
                        if (Number.isFinite(length) && length > MAX_AVATAR_BYTES) return null;
                        const image = Buffer.from(await response.arrayBuffer());
                        if (!image.length || image.length > MAX_AVATAR_BYTES) return null;
                        return `data:${response.headers.get('content-type').split(';', 1)[0]};base64,${image.toString('base64')}`;
                    }));
                if (cache.size > 32) cache.delete(cache.keys().next().value);
            }
            const image = await cache.get(url);
            if (!image) throw new Error('Réponse image invalide.');
            return image;
        }));
        return { avatarDataUri, avatarUrls };
    } catch {
        return { avatarDataUri: null, avatarUrls };
    }
}

function createTikTokSession(sendToClients, username, onRoomState = () => {}) {
    const connection = new TikTokLiveConnection(username, {});
    const processedGiftMessageIds = new Set();
    const avatarLookupTimes = new Map();
    const avatarCache = new Map();
    let active = true;

    const send = message => {
        if (active) sendToClients(message);
    };

    connection.on('gift', async gift => {
        const giftType = Number(
            gift.giftDetails?.giftType ??
            gift.giftType ??
            gift.gift?.gift_type ??
            gift.gift?.giftType ??
            gift.gift?.type
        );
        const repeatEnd = gift.repeatEnd === true ||
            Number(gift.repeatEnd ?? gift.gift?.repeat_end ?? gift.gift?.repeatEnd) === 1;
        if (giftType === 1 && !repeatEnd) return;

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
        if (!Number.isSafeInteger(coinCount) || coinCount < 1) return;

        const messageId = String(gift.common?.msgId ?? '');
        if (messageId && processedGiftMessageIds.has(messageId)) return;
        if (messageId) {
            processedGiftMessageIds.add(messageId);
            if (processedGiftMessageIds.size > 5000) {
                processedGiftMessageIds.delete(processedGiftMessageIds.values().next().value);
            }
        }

        const { avatarDataUri, avatarUrls } = await getAvatarData(gift.user, avatarCache);
        send({
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
                giftName: gift.gift?.name || ''
            }
        });
    });

    connection.on('chat', message => {
        const username = message.user?.displayId || message.user?.nickname || '';
        send({
            type: 'comment',
            commentData: { username, comment: message.content || '' }
        });

        const viewerKey = String(message.user?.uniqueId || username).toLocaleLowerCase();
        const lastLookup = avatarLookupTimes.get(viewerKey) || 0;
        if (!viewerKey || Date.now() - lastLookup < 60000) return;
        avatarLookupTimes.set(viewerKey, Date.now());
        if (avatarLookupTimes.size > 500) {
            avatarLookupTimes.delete(avatarLookupTimes.keys().next().value);
        }

        getAvatarData(message.user, avatarCache).then(({ avatarDataUri }) => {
            if (avatarDataUri) send({ type: 'viewer', viewer: { username, avatarDataUri } });
        }).catch(error => {
            console.warn(`Impossible de charger l’avatar TikTok de ${username || 'un spectateur'} :`, error);
        });
    });

    connection.on('like', message => {
        const likeCount = Math.floor(Number(message.likeCount) || 0);
        if (likeCount < 1) return;
        send({
            type: 'like',
            likeData: {
                username: message.user?.uniqueId || message.user?.nickname || '',
                nickname: message.user?.nickname || '',
                likeCount
            }
        });
    });

    connection.on('disconnected', () => {
        onRoomState({ connected: false, roomId: null });
        send({ type: 'STATUS', message: `Connexion TikTok interrompue · @${username}` });
    });

    connection.connect()
        .then(state => {
            if (!active) return;
            onRoomState({ connected: true, roomId: String(state.roomId || '') });
            console.info(`Connecté au live TikTok @${username}. Room ID : ${state.roomId}`);
            send({ type: 'STATUS', message: `Direct TikTok connecté · @${username}` });
        })
        .catch(error => {
            if (!active) return;
            onRoomState({ connected: false, roomId: null });
            console.error(`Erreur de connexion TikTok @${username} :`, error);
            send({ type: 'STATUS', message: `Erreur de connexion TikTok · @${username}` });
        });

    return async () => {
        active = false;
        try {
            await connection.disconnect();
        } catch (error) {
            console.warn(`Déconnexion TikTok impossible pour @${username} :`, error.message);
        }
    };
}

module.exports = { createTikTokSession };
