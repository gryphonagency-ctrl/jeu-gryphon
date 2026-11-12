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

function getTikTokIdentity(user) {
    const username = String(user?.displayId || user?.nickname || '');
    const uniqueId = String(user?.uniqueId || user?.displayId || '');
    const rawUserId = user?.userId ?? user?.uid ?? user?.id;
    return {
        userId: rawUserId === undefined || rawUserId === null ? '' : String(rawUserId),
        uniqueId,
        username,
        nickname: String(user?.nickname || ''),
        avatarUrls: getAvatarUrls(user)
    };
}

function getTeamMemberLevel(user) {
    const badgeLevel = Array.isArray(user?.userBadges)
        ? user.userBadges.find(badge => Number(badge?.badgeSceneType) === 10)?.level
        : undefined;
    const level = Number(user?.teamMemberLevel ?? user?.userAttributes?.teamMemberLevel ?? badgeLevel);
    return Number.isSafeInteger(level) && level > 0 ? level : null;
}

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
        gift.gift?.giftImageUrl,
        gift.gift?.giftImage?.urlList,
        gift.gift?.giftImage?.url_list,
        gift.gift?.imageUrl,
        gift.gift?.image?.urlList,
        gift.gift?.image?.url_list,
        gift.giftDetails?.giftImage?.url_list,
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
    } catch (error) {
        console.warn('Impossible de récupérer une photo de profil TikTok :', error.message);
        return { avatarDataUri: null, avatarUrls };
    }
}

function createTikTokSession(sendToClients, username, onRoomState = () => {}, { diagnostics = false } = {}) {
    const connection = new TikTokLiveConnection(username, {});
    const processedGiftMessageIds = new Set();
    const teamMemberLevels = new Map();
    const avatarLookupTimes = new Map();
    const avatarCache = new Map();
    const logDiagnostic = (event, details) => {
        if (diagnostics && process.env.LIVE_TIKTOK_DIAGNOSTICS === 'true') {
            console.info(`[TikTok diagnostic] ${event} ${JSON.stringify(details)}`);
        }
    };
    let active = true;
    let connecting = false;
    let retryTimer = null;
    let liveMatchActive = false;

    const send = message => {
        if (active) sendToClients(message);
    };

    const trackTeamMemberLevel = (user, messageId, sentAt) => {
        const teamMemberLevel = getTeamMemberLevel(user);
        const identity = getTikTokIdentity(user);
        const teamMemberKey = String(identity.userId || identity.uniqueId || identity.username)
            .trim().toLocaleLowerCase();
        if (!teamMemberKey || teamMemberLevel === null) return;
        const previousLevel = teamMemberLevels.get(teamMemberKey);
        teamMemberLevels.set(teamMemberKey, teamMemberLevel);
        if (previousLevel !== undefined && teamMemberLevel > previousLevel) {
            const levelMessageId = messageId
                ? `${messageId}:level:${teamMemberLevel}`
                : `${teamMemberKey}:level:${teamMemberLevel}:${sentAt}`;
            send({
                type: 'level-up',
                sourceTikTokUsername: username,
                levelUp: {
                    messageId: levelMessageId,
                    ...identity,
                    teamMemberLevel
                }
            });
        }
        if (teamMemberLevels.size > 10000) {
            teamMemberLevels.delete(teamMemberLevels.keys().next().value);
        }
    };

    const scheduleReconnect = () => {
        if (!active || retryTimer) return;
        retryTimer = setTimeout(() => {
            retryTimer = null;
            connect();
        }, 30_000);
        retryTimer.unref?.();
    };

    connection.on('linkMicBattle', battle => {
        const action = Number(battle.action);
        if (action === 4 || action === 7) liveMatchActive = true;
        else if ([3, 5, 6, 11].includes(action)) liveMatchActive = false;
    });

    connection.on('streamEnd', event => {
        liveMatchActive = false;
        teamMemberLevels.clear();
        send({
            type: 'LIVE_END',
            action: Number(event?.action) || null
        });
        onRoomState({ connected: false, roomId: null });
    });

    connection.on('gift', async gift => {
        const receivedAt = Date.now();
        const providerTimestamp = Number(gift.common?.createTime);
        const sentAt = Number.isSafeInteger(providerTimestamp)
            ? providerTimestamp < 1_000_000_000_000 ? providerTimestamp * 1000 : providerTimestamp
            : receivedAt;
        const rawGiftId = gift.giftId ?? gift.gift?.id;
        const parsedGiftId = Number(rawGiftId);
        const giftId = Number.isSafeInteger(parsedGiftId) ? parsedGiftId : null;
        const giftName = String(gift.gift?.name || '');
        const giftType = Number(
            gift.giftDetails?.giftType ??
            gift.giftType ??
            gift.gift?.gift_type ??
            gift.gift?.giftType ??
            gift.gift?.type
        );
        const repeatEnd = gift.repeatEnd === true ||
            Number(gift.repeatEnd ?? gift.gift?.repeat_end ?? gift.gift?.repeatEnd) === 1;
        const messageId = String(gift.common?.msgId ?? '');

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
        const diagnosticDetails = {
            account: username,
            giftId,
            giftName,
            giftType,
            repeatEnd,
            repeatCount,
            coinCount,
            timestamp: new Date().toISOString()
        };
        if (giftType === 1 && !repeatEnd) {
            trackTeamMemberLevel(gift.user, messageId, sentAt);
            logDiagnostic('cadeau', { ...diagnosticDetails, result: 'combo-incomplet' });
            return;
        }
        if (!Number.isSafeInteger(coinCount) || coinCount < 1) {
            logDiagnostic('cadeau', { ...diagnosticDetails, result: 'valeur-invalide' });
            return;
        }

        if (messageId && processedGiftMessageIds.has(messageId)) {
            logDiagnostic('cadeau', { ...diagnosticDetails, result: 'doublon' });
            return;
        }
        if (messageId) {
            processedGiftMessageIds.add(messageId);
            if (processedGiftMessageIds.size > 5000) {
                processedGiftMessageIds.delete(processedGiftMessageIds.values().next().value);
            }
        }

        logDiagnostic('cadeau', { ...diagnosticDetails, result: 'transmis' });
        const identity = getTikTokIdentity(gift.user);
        send({
            type: 'gift',
            gift: {
                messageId,
                sentAt,
                giftId: Number.isSafeInteger(giftId) ? giftId : null,
                ...identity,
                avatarDataUri: null,
                coinValue,
                giftType,
                repeatCount: appliedRepeatCount,
                coinCount,
                liveMatchActive,
                giftName,
                giftImageUrl: getTikTokGiftImageUrl(gift)
            }
        });
        trackTeamMemberLevel(gift.user, messageId, sentAt);
        getAvatarData(gift.user, avatarCache).then(({ avatarDataUri }) => {
            if (avatarDataUri) {
                send({
                    type: 'viewer',
                    viewer: {
                        ...identity,
                        avatarDataUri
                    }
                });
            }
        }).catch(error => {
            console.warn(`Impossible de charger l’avatar du cadeau de ${gift.user?.nickname || 'un spectateur'} :`, error);
        });
    });

    connection.on('member', message => {
        const providerTimestamp = Number(message?.common?.createTime ?? message?.createTime);
        const sentAt = Number.isSafeInteger(providerTimestamp)
            ? providerTimestamp < 1_000_000_000_000 ? providerTimestamp * 1000 : providerTimestamp
            : Date.now();
        const messageId = String(message?.common?.msgId ?? message?.msgId ?? '');
        trackTeamMemberLevel(message?.user || message, messageId, sentAt);
    });

    connection.on('chat', message => {
        const identity = getTikTokIdentity(message.user);
        const username = identity.username;
        send({
            type: 'comment',
            commentData: {
                ...identity,
                messageId: String(message.common?.msgId || ''),
                comment: message.content || ''
            }
        });

        const viewerKey = String(identity.userId || identity.uniqueId || username).toLocaleLowerCase();
        const lastLookup = avatarLookupTimes.get(viewerKey) || 0;
        if (!viewerKey || Date.now() - lastLookup < 60000) return;
        avatarLookupTimes.set(viewerKey, Date.now());
        if (avatarLookupTimes.size > 500) {
            avatarLookupTimes.delete(avatarLookupTimes.keys().next().value);
        }

        getAvatarData(message.user, avatarCache).then(({ avatarDataUri }) => {
            if (avatarDataUri) send({ type: 'viewer', viewer: { ...identity, avatarDataUri } });
        }).catch(error => {
            console.warn(`Impossible de charger l’avatar TikTok de ${username || 'un spectateur'} :`, error);
        });
    });

    connection.on('share', message => {
        const identity = getTikTokIdentity(message.user);
        send({
            type: 'share',
            shareData: {
                messageId: String(message.common?.msgId || ''),
                username: identity.uniqueId || identity.username,
                nickname: identity.nickname
            }
        });
    });

    const handleFollow = message => {
        const identity = getTikTokIdentity(message.user);
        send({
            type: 'follow',
            followData: {
                messageId: String(message.common?.msgId || ''),
                username: identity.uniqueId || identity.username,
                nickname: identity.nickname
            }
        });
    };

    connection.on('follow', handleFollow);
    connection.on('social', message => {
        const displayText = [
            message.common?.displayText?.key,
            message.displayType,
            message.action
        ].filter(Boolean).join(' ').toLocaleLowerCase();
        if (displayText.includes('follow') || Number(message.followType) > 0) {
            handleFollow(message);
        }
    });

    connection.on('subNotify', message => {
        const identity = getTikTokIdentity(message.user);
        send({
            type: 'subscribe',
            subscribeData: { username: identity.uniqueId || identity.username, nickname: identity.nickname }
        });
    });

    connection.on('like', async message => {
        const likeCount = Math.floor(Number(message.likeCount ?? message.count) || 0);
        if (likeCount < 1) return;
        const identity = getTikTokIdentity(message.user);
        let avatarDataUri = null;
        try {
            ({ avatarDataUri } = await getAvatarData(message.user, avatarCache));
        } catch (error) {
            console.warn(`Impossible de charger l’avatar TikTok de ${identity.username || 'un spectateur'} :`, error);
        }
        send({
            type: 'like',
            likeData: {
                messageId: String(message.common?.msgId || ''),
                userId: identity.userId,
                username: identity.uniqueId || identity.username,
                uniqueId: identity.uniqueId || identity.username,
                nickname: identity.nickname,
                likeCount,
                avatarDataUri,
                avatarUrls: identity.avatarUrls
            }
        });
    });

    connection.on('disconnected', () => {
        liveMatchActive = false;
        logDiagnostic('connexion', {
            account: username,
            state: 'interrompue',
            timestamp: new Date().toISOString()
        });
        onRoomState({ connected: false, roomId: null });
        send({ type: 'STATUS', message: `Connexion TikTok interrompue · @${username}` });
        scheduleReconnect();
    });

    function connect() {
        if (!active || connecting) return;
        connecting = true;
        connection.connect()
            .then(state => {
                if (!active) return;
                onRoomState({ connected: true, roomId: String(state.roomId || '') });
                logDiagnostic('connexion', {
                    account: username,
                    state: 'connectee',
                    roomId: String(state.roomId || ''),
                    timestamp: new Date().toISOString()
                });
                console.info(`Connecté au live TikTok @${username}. Room ID : ${state.roomId}`);
                send({ type: 'STATUS', message: `Direct TikTok connecté · @${username}` });
                connection.fetchAvailableGifts().then(availableGifts => {
                    if (!active) return;
                    const gifts = Array.isArray(availableGifts)
                        ? availableGifts.slice(0, 2000).flatMap(gift => {
                            const id = Number(gift?.id);
                            const name = String(gift?.name || '').trim().slice(0, 100);
                            if (!Number.isSafeInteger(id) || id < 1 || !name) return [];
                            const coinValue = Number(gift?.diamond_count ?? gift?.diamondCount);
                            return [{
                                id,
                                name,
                                coinValue: Number.isSafeInteger(coinValue) && coinValue >= 0 ? coinValue : null,
                                imageUrl: getTikTokGiftImageUrl(gift)
                            }];
                        })
                        : [];
                    send({ type: 'AVAILABLE_GIFTS', gifts });
                }).catch(error => {
                    if (!active) return;
                    console.warn(`Impossible de charger les cadeaux TikTok pour @${username} :`, error.message);
                    send({
                        type: 'AVAILABLE_GIFTS_ERROR',
                        message: 'Catalogue indisponible. Vérifie que le direct TikTok est en cours, puis réessaie.'
                    });
                });
            })
            .catch(error => {
                if (!active) return;
                onRoomState({ connected: false, roomId: null });
                const detail = error instanceof Error
                    ? error.message.replace(/https?:\/\/\S+/gi, '[adresse masquée]').slice(0, 180)
                    : 'Cause inconnue.';
                logDiagnostic('connexion', {
                    account: username,
                    state: 'echec',
                    error: detail || 'Cause inconnue.',
                    timestamp: new Date().toISOString()
                });
                console.error(`Erreur de connexion TikTok @${username} :`, error);
                send({ type: 'STATUS', message: `Erreur de connexion TikTok · @${username} : ${detail || 'Cause inconnue.'}` });
                scheduleReconnect();
            })
            .finally(() => {
                connecting = false;
            });
    }

    connect();

    return async () => {
        active = false;
        if (retryTimer) clearTimeout(retryTimer);
        try {
            await connection.disconnect();
        } catch (error) {
            console.warn(`Déconnexion TikTok impossible pour @${username} :`, error.message);
        }
    };
}

module.exports = { createTikTokSession };
