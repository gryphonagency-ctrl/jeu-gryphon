/*
 * Griffon Arcade — effets de live communs à tous les jeux.
 *  - partage du live      -> petit avion en papier discret
 *  - gros cadeau (>= 100) -> bulle et feu d'artifice, réglables par compte
 *  - niveau Fan Club      -> média personnalisé plein écran, dans tous les jeux
 *  - cadeau reçu           -> son visuel réel est ajouté au coffre activable par compte
 * Le script écoute les WebSocket TikTok de la page : aucun jeu n'a besoin d'être modifié.
 */
(function () {
    'use strict';
    if (window.ArcadeEffects) return;

    const config = { bigGiftCoins: 100, sound: true, volume: 0.5 };
    const seen = new Set();
    const seenTreasureGifts = new Set();
    const mediaAlerts = new Map();
    const mediaAlertRequests = new Map();
    const mediaAlertQueue = [];
    const avatars = new Map();
    const liveBubbles = new Map();
    let bigGiftOverlayEnabled = false;
    let bigGiftFireworksEnabled = false;
    let treasureChestEnabled = false;
    let treasureOwner = '';
    let treasureSourceUsername = '';
    let treasureLiveRoomId = '';
    let treasureCanEdit = false;
    let treasureEditingEnabled = false;
    let treasureDragActive = false;
    let treasureLayoutSaving = false;
    let treasureGiftCount = 0;
    let treasureGiftItems = [];
    let treasureGiftResetAt = 0;
    let treasureGiftServerResetAt = 0;
    let mediaAlertPlaying = false;
    let mediaAlertVideo = null;
    let mediaAlertAudio = null;
    let treasureLayout = { x: 50, y: 82, width: 38, giftSize: 72 };
    let treasureStage = null;
    let layer = null, canvas = null, ctx = null, particles = [], raf = 0;
    let overlaySettingsRefreshInFlight = false;

    async function refreshOverlaySettings() {
        if (overlaySettingsRefreshInFlight || document.hidden) return;
        overlaySettingsRefreshInFlight = true;
        try {
            if (location.pathname === '/arcade-treasure-overlay.html') {
                const token = new URLSearchParams(location.search).get('token');
                if (!token) throw new Error('Le lien du coffre au trésor ne contient pas de jeton.');
                const response = await fetch(
                    `/api/arcade-treasure-overlay-status?token=${encodeURIComponent(token)}`,
                    { credentials: 'same-origin', cache: 'no-store' }
                );
                if (!response.ok) throw new Error(`Overlay coffre HTTP ${response.status}`);
                const settings = await response.json();
                if (!treasureDragActive && !treasureLayoutSaving) setTreasureLayout(settings.layout);
                const sessionResponse = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
                if (!sessionResponse.ok) throw new Error(`Session HTTP ${sessionResponse.status}`);
                const session = await sessionResponse.json();
                setTreasureEditPermission(
                    session.authenticated === true &&
                    String(session.username || '').toLowerCase() === String(settings.owner || '').toLowerCase()
                );
                treasureEditingEnabled = session.authenticated === true &&
                    session.arcadeTreasureLayoutEditing === true;
                bigGiftOverlayEnabled = false;
                bigGiftFireworksEnabled = false;
                setTreasureChestEnabled(
                    settings.enabled === true,
                    settings.owner || '',
                    settings.username || ''
                );
                resetTreasureGiftsFromServer(settings.resetAt);
                applyTreasureLayout();
                return;
            }
            const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
            if (!response.ok) throw new Error(`Session HTTP ${response.status}`);
            const session = await response.json();
            bigGiftFireworksEnabled = session.isAdmin !== true;
            bigGiftOverlayEnabled = session.authenticated === true &&
                session.canAccessGames === true &&
                session.arcadeBigGiftOverlayEnabled === true;
            setTreasureChestEnabled(
                session.authenticated === true && session.arcadeTreasureChestEnabled === true,
                session.username || '',
                session.arcadeTreasureTikTokUsername || session.tiktokUsername || ''
            );
            setTreasureEditPermission(session.authenticated === true);
            treasureEditingEnabled = session.authenticated === true &&
                session.arcadeTreasureLayoutEditing === true;
            applyTreasureLayout();
            if (!treasureDragActive && !treasureLayoutSaving) {
                setTreasureLayout(session.arcadeTreasureLayout);
            }
        } catch (error) {
            console.warn('Préférences des overlays Griffon Arcade indisponibles :', error.message);
        } finally {
            overlaySettingsRefreshInFlight = false;
        }
    }

    void refreshOverlaySettings();
    window.setInterval(() => {
        void refreshOverlaySettings();
    }, 30000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) void refreshOverlaySettings();
    });

    function injectStyle() {
        if (document.getElementById('arcade-effects-style')) return;
        const style = document.createElement('style');
        style.id = 'arcade-effects-style';
        style.textContent = `
#arcade-effects-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden}
#arcade-effects-layer canvas{position:absolute;inset:0;width:100%;height:100%}
.ae-plane{position:absolute;left:0;top:0;width:227px;height:227px;opacity:.8;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
.ae-plane svg{width:100%;height:100%;display:block}
.ae-bubble{position:absolute;bottom:-130px;width:88px;display:flex;flex-direction:column;align-items:center;gap:6px;will-change:transform,opacity}
.ae-bubble .ae-orb{position:relative;width:88px;height:88px;border-radius:50%;padding:5px;box-sizing:border-box;
 background:radial-gradient(circle at 30% 25%,rgba(255,255,255,.95),rgba(255,255,255,.25) 40%,rgba(120,200,255,.35));
 border:2px solid rgba(255,255,255,.85);box-shadow:0 0 18px rgba(120,200,255,.8),inset 0 0 14px rgba(255,255,255,.7)}
.ae-bubble .ae-orb img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}
.ae-bubble .ae-orb .ae-initial{width:100%;height:100%;border-radius:50%}
.ae-bubble .ae-initial{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#ff2e93,#ffb400);color:#fff;font:900 34px/1 Arial,sans-serif}
.ae-bubble .ae-name{max-width:150px;padding:2px 10px;border-radius:99px;background:rgba(0,0,0,.6);color:#fff;font:700 13px/1.4 Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ae-treasure{position:absolute;inset:0;pointer-events:none}
.ae-treasure-zone{position:absolute;box-sizing:border-box;z-index:2;opacity:0;pointer-events:none;user-select:none}
.ae-treasure-gifts{position:absolute;inset:0;z-index:3}
.ae-treasure-gift{position:absolute;display:flex;align-items:center;justify-content:center;
 overflow:visible;border:0;border-radius:0;background:transparent;box-shadow:none;will-change:transform;filter:drop-shadow(0 3px 4px rgba(0,0,0,.7))}
.ae-treasure-gift img{position:absolute;width:100%;height:100%;object-fit:contain;filter:url(#ae-treasure-cutout)}
.ae-treasure-gift-name{max-width:100%;padding:2px;color:#fff4cf;text-align:center;font:700 8px/1.1 Arial,sans-serif;overflow:hidden;overflow-wrap:anywhere}
.ae-treasure-handle{position:absolute;z-index:4;display:none;pointer-events:auto;touch-action:none;border:2px solid #fff3b1;border-radius:10px;
 background:rgba(24,18,10,.88);color:white;box-shadow:0 2px 10px rgba(0,0,0,.55);font:800 18px/1 Arial,sans-serif}
.ae-treasure-edit .ae-treasure-zone{opacity:1;pointer-events:auto;cursor:move;border:2px dashed rgba(255,243,177,.8);border-radius:8px;background:rgba(255,243,177,.05)}
.ae-treasure-edit .ae-treasure-handle{display:grid;place-items:center}
.ae-treasure-move{width:42px;height:42px;cursor:move}
.ae-treasure-resize{width:38px;height:38px;cursor:nwse-resize}
.ae-sound-unlock{position:fixed;z-index:2147483647;left:50%;bottom:max(14px,env(safe-area-inset-bottom));transform:translateX(-50%);padding:10px 16px;border:1px solid rgba(255,255,255,.7);border-radius:999px;background:rgba(8,12,24,.94);color:#fff;font:700 14px Arial,sans-serif;cursor:pointer;pointer-events:auto}
@media (prefers-reduced-motion:reduce){.ae-plane{opacity:.6}}`;
        document.head.appendChild(style);
    }

    function ensureLayer() {
        if (layer && layer.isConnected) return layer;
        injectStyle();
        layer = document.createElement('div');
        layer.id = 'arcade-effects-layer';
        layer.setAttribute('aria-hidden', 'true');
        (document.body || document.documentElement).appendChild(layer);
        canvas = null;
        return layer;
    }

    function ensureCanvas() {
        ensureLayer();
        if (canvas && canvas.isConnected) return;
        canvas = document.createElement('canvas');
        layer.appendChild(canvas);
        ctx = canvas.getContext('2d');
        resizeCanvas();
    }

    function resizeCanvas() {
        if (canvas) {
            const ratio = Math.min(2, window.devicePixelRatio || 1);
            canvas.width = Math.round(window.innerWidth * ratio);
            canvas.height = Math.round(window.innerHeight * ratio);
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
        applyTreasureLayout();
    }
    window.addEventListener('resize', resizeCanvas);

    /* ---------- coffre au trésor ---------- */
    const TREASURE_STORAGE_PREFIX = 'ga-arcade-treasure-gifts:';
    const TREASURE_LAYOUT_STORAGE_KEY = 'ga-arcade-treasure-layout';
    const TREASURE_EDIT_STORAGE_KEY = 'ga-arcade-treasure-layout-edit';
    const DEFAULT_TREASURE_LAYOUT = { x: 50, y: 82, width: 38, giftSize: 72 };

    function normalizeTreasureLayout(layout) {
        if (!layout || !Number.isFinite(layout.x) || !Number.isFinite(layout.y) ||
            !Number.isFinite(layout.width)) return { ...DEFAULT_TREASURE_LAYOUT };
        return {
            x: Math.max(0, Math.min(100, layout.x)),
            y: Math.max(0, Math.min(100, layout.y)),
            width: Math.max(12, Math.min(90, layout.width)),
            giftSize: Number.isFinite(layout.giftSize)
                ? Math.max(24, Math.min(144, layout.giftSize))
                : DEFAULT_TREASURE_LAYOUT.giftSize
        };
    }

    function treasureZoneBounds() {
        const zone = treasureStage && treasureStage.querySelector('.ae-treasure-zone');
        if (!zone) return null;
        const bounds = zone.getBoundingClientRect();
        return bounds.width && bounds.height ? bounds : null;
    }

    function treasurePileSlots(bounds) {
        const size = Math.max(20, Math.min(
            treasureLayout.giftSize,
            window.innerWidth * 0.1,
            window.innerHeight * 0.2
        ));
        if (!bounds || !bounds.width || !bounds.height) {
            return [{
                x: window.innerWidth / 2 - size / 2,
                y: window.innerHeight / 2 - size / 2,
                width: size,
                row: 0
            }];
        }
        const horizontalStep = size * 0.72;
        const verticalStep = size * 0.62;
        const columns = Math.max(1, Math.floor((bounds.width - size) / horizontalStep) + 1);
        const maxRows = Math.max(1, Math.floor((bounds.height - size * 0.38) / verticalStep) + 1);
        const rows = Math.min(maxRows, Math.max(1, Math.ceil(columns * 0.75)));
        const centerX = bounds.left + bounds.width * 0.5;
        const baseY = bounds.bottom - size;
        const slots = [];
        for (let row = 0; row < rows; row++) {
            const count = Math.max(1, Math.round(columns * (rows - row) / rows));
            const offsets = Array.from({ length: count }, (_, index) => index - (count - 1) / 2);
            const orderedOffsets = offsets.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
            orderedOffsets.forEach(offset => {
                slots.push({
                    x: centerX + offset * horizontalStep - size / 2,
                    y: baseY - row * verticalStep,
                    width: size,
                    row
                });
            });
        }
        return slots;
    }

    function treasureEditIsRequested() {
        if (!treasureOwner || !treasureCanEdit) return false;
        if (treasureEditingEnabled) return true;
        try {
            const setting = JSON.parse(localStorage.getItem(TREASURE_EDIT_STORAGE_KEY) || 'null');
            return setting?.enabled === true &&
                String(setting.username || '').toLowerCase() === treasureOwner.toLowerCase();
        } catch (error) {
            console.warn('Le mode de déplacement du coffre ne peut pas être lu :', error.message);
            return false;
        }
    }

    function ensureTreasureStage() {
        if (treasureStage && treasureStage.isConnected) return;
        ensureLayer();
        treasureStage = document.createElement('div');
        treasureStage.className = 'ae-treasure';
        const gifts = document.createElement('div');
        gifts.className = 'ae-treasure-gifts';
        const zone = document.createElement('div');
        zone.className = 'ae-treasure-zone';
        zone.setAttribute('aria-hidden', 'true');
        const moveHandle = document.createElement('button');
        moveHandle.className = 'ae-treasure-handle ae-treasure-move';
        moveHandle.type = 'button';
        moveHandle.textContent = '↕';
        moveHandle.setAttribute('aria-label', 'Déplacer la zone des cadeaux');
        const resizeHandle = document.createElement('button');
        resizeHandle.className = 'ae-treasure-handle ae-treasure-resize';
        resizeHandle.type = 'button';
        resizeHandle.textContent = '↘';
        resizeHandle.setAttribute('aria-label', 'Redimensionner la zone des cadeaux');
        const filterSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        filterSvg.setAttribute('aria-hidden', 'true');
        filterSvg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
        filterSvg.innerHTML = '<filter id="ae-treasure-cutout" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0.2126 0.7152 0.0722 0 0" result="giftLuminance"/><feComponentTransfer in="giftLuminance" result="giftCutout"><feFuncA type="table" tableValues="0 0 0.02 0.05 0.1 0.2 0.35 0.5 0.65 0.78 0.88 0.94 0.98 1 1 1 1"/></feComponentTransfer><feComposite in="giftCutout" in2="SourceGraphic" operator="in"/></filter>';
        treasureStage.append(filterSvg, gifts, zone, moveHandle, resizeHandle);
        layer.appendChild(treasureStage);
        bindTreasureDrag(zone, 'move');
        bindTreasureDrag(moveHandle, 'move');
        bindTreasureDrag(resizeHandle, 'resize');
        applyTreasureLayout();
        renderTreasureGifts();
    }

    function applyTreasureLayout() {
        if (!treasureStage || !treasureStage.isConnected) return;
        const zone = treasureStage.querySelector('.ae-treasure-zone');
        const moveHandle = treasureStage.querySelector('.ae-treasure-move');
        const resizeHandle = treasureStage.querySelector('.ae-treasure-resize');
        const x = `${treasureLayout.x}%`;
        const baseY = Math.max(14, treasureLayout.y);
        const y = `${baseY}%`;
        zone.style.left = x;
        zone.style.top = y;
        zone.style.width = `${treasureLayout.width}vw`;
        zone.style.height = `${Math.max(12, Math.min(76, baseY - 4))}vh`;
        zone.style.transform = 'translate(-50%, -100%)';
        const zoneBounds = treasureZoneBounds();
        if (zoneBounds) {
            moveHandle.style.left = `${zoneBounds.left + 8}px`;
            moveHandle.style.top = `${zoneBounds.top + 8}px`;
            resizeHandle.style.left = `${zoneBounds.right - 46}px`;
            resizeHandle.style.top = `${zoneBounds.bottom - 46}px`;
        }
        treasureStage.classList.toggle('ae-treasure-edit', treasureEditIsRequested());
        renderTreasureGifts();
    }

    function safeGiftImageUrl(value) {
        if (typeof value !== 'string' || value.length > 2048) return '';
        try {
            const url = new URL(value, location.href);
            return url.protocol === 'https:' ? url.href : '';
        } catch (error) {
            return '';
        }
    }

    function renderTreasureGifts() {
        if (!treasureStage || !treasureStage.isConnected) return;
        const container = treasureStage.querySelector('.ae-treasure-gifts');
        if (!container) return;
        const bounds = treasureZoneBounds();
        const existingItems = new Map(
            [...container.children].map(item => [Number(item.dataset.pileSlot), item])
        );
        const slots = treasurePileSlots(bounds);
        const visibleGifts = new Map();
        let nextSlot = 0;
        for (const giftEntry of treasureGiftItems) {
            const count = Math.max(0, Math.floor(giftEntry.count));
            const firstSlot = nextSlot;
            for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
                const firstOffset = (slotIndex - firstSlot + slots.length) % slots.length;
                if (firstOffset >= count) continue;
                const giftCount = Math.floor((count - 1 - firstOffset) / slots.length) + 1;
                const pile = visibleGifts.get(slotIndex) || { gifts: [], count: 0 };
                pile.gifts.push(giftEntry);
                pile.count += giftCount;
                visibleGifts.set(slotIndex, pile);
            }
            nextSlot = (nextSlot + count % slots.length) % slots.length;
        }
        for (const [slotIndex, pile] of visibleGifts) {
            const item = existingItems.get(slotIndex) || document.createElement('span');
            existingItems.delete(slotIndex);
            item.replaceChildren();
            const position = slots[slotIndex];
            const size = Math.max(20, Math.min(
                treasureLayout.giftSize,
                window.innerWidth * 0.1,
                window.innerHeight * 0.2
            ));
            item.className = 'ae-treasure-gift';
            item.dataset.pileSlot = String(slotIndex);
            item.style.left = `${position.x}px`;
            item.style.top = `${position.y}px`;
            item.style.width = `${size}px`;
            item.style.height = `${size}px`;
            item.style.zIndex = String(10 + slots.length - position.row);
            const giftTypes = pile.gifts.slice(-3);
            if (giftTypes.length === 1 && pile.count > 1) {
                giftTypes.unshift(giftTypes[0]);
                if (pile.count > 2) giftTypes.unshift(giftTypes[0]);
            }
            item.title = pile.gifts[pile.gifts.length - 1].name || 'Cadeau TikTok reçu';
            giftTypes.forEach((gift, layerIndex) => {
                if (gift.imageUrl) {
                    const image = document.createElement('img');
                    image.src = gift.imageUrl;
                    image.alt = '';
                    image.setAttribute('aria-hidden', 'true');
                    image.loading = 'lazy';
                    image.referrerPolicy = 'no-referrer';
                    image.style.left = `${layerIndex * 3}px`;
                    image.style.top = `${-layerIndex * 4}px`;
                    image.style.transform = `rotate(${((slotIndex + layerIndex) % 5 - 2) * 4}deg)`;
                    image.onerror = () => {
                        image.remove();
                        const fallback = document.createElement('span');
                        fallback.className = 'ae-treasure-gift-name';
                        fallback.textContent = gift.name || 'Cadeau reçu';
                        item.prepend(fallback);
                    };
                    item.appendChild(image);
                } else {
                    const fallback = document.createElement('span');
                    fallback.className = 'ae-treasure-gift-name';
                    fallback.textContent = gift.name || 'Cadeau reçu';
                    item.appendChild(fallback);
                }
            });
            container.appendChild(item);
        }
        existingItems.forEach(item => item.remove());
    }

    function resetTreasureGifts(liveRoomId = '') {
        treasureGiftCount = 0;
        treasureGiftItems = [];
        treasureLiveRoomId = String(liveRoomId || '');
        treasureGiftResetAt = Math.max(Date.now(), treasureGiftResetAt + 1);
        seenTreasureGifts.clear();
        saveTreasureGifts();
        renderTreasureGifts();
    }

    function resetTreasureGiftsFromServer(resetAt) {
        if (!Number.isSafeInteger(resetAt) || resetAt <= treasureGiftServerResetAt) return;
        treasureGiftCount = 0;
        treasureGiftItems = [];
        treasureLiveRoomId = '';
        treasureGiftResetAt = Math.max(Date.now(), treasureGiftResetAt + 1);
        treasureGiftServerResetAt = resetAt;
        seenTreasureGifts.clear();
        saveTreasureGifts();
        renderTreasureGifts();
    }

    window.addEventListener('arcade:treasure-reset', event => {
        resetTreasureGiftsFromServer(event.detail?.resetAt);
    });

    function handleTreasureLiveState(data) {
        if (!treasureChestEnabled ||
            !treasureSourceUsername ||
            String(data.sourceTikTokUsername || '').trim().replace(/^@/, '').toLocaleLowerCase() !== treasureSourceUsername) return;
        if (data.type === 'LIVE_END') {
            resetTreasureGifts();
            return;
        }
        const roomId = String(data.roomId || '');
        const lastEndedRoomId = String(data.lastEndedRoomId || '');
        if (data.type !== 'LIVE_STATE') return;
        if (lastEndedRoomId && (!data.isLive || lastEndedRoomId === treasureLiveRoomId)) {
            resetTreasureGifts(data.isLive === true ? roomId : '');
        } else if (data.isLive === true && roomId && !treasureLiveRoomId) {
            treasureLiveRoomId = roomId;
            saveTreasureGifts();
        }
    }

    function readTreasureGifts(owner) {
        if (!owner) return;
        treasureGiftServerResetAt = 0;
        try {
            const stored = JSON.parse(localStorage.getItem(TREASURE_STORAGE_PREFIX + owner.toLowerCase()) || 'null');
            if (!stored || !Array.isArray(stored.gifts)) {
                treasureGiftResetAt = Date.now();
                saveTreasureGifts();
                return;
            }
            treasureGiftCount = Number.isSafeInteger(stored.total) && stored.total > 0 ? stored.total : 0;
            treasureLiveRoomId = typeof stored.liveRoomId === 'string' ? stored.liveRoomId : '';
            treasureGiftResetAt = Number.isSafeInteger(stored.resetAt) && stored.resetAt > 0
                ? stored.resetAt
                : Date.now();
            treasureGiftServerResetAt = Number.isSafeInteger(stored.serverResetAt) && stored.serverResetAt > 0
                ? stored.serverResetAt
                : 0;
            const gifts = stored.gifts
                .filter(gift => gift && typeof gift === 'object')
                .map(gift => ({
                    name: String(gift.name || '').slice(0, 80),
                    imageUrl: safeGiftImageUrl(gift.imageUrl),
                    count: Number.isSafeInteger(gift.count) && gift.count > 0 ? gift.count : 1
                }))
                .filter(gift => gift.imageUrl || gift.name);
            treasureGiftItems = gifts;
        } catch (error) {
            console.warn('Les cadeaux du coffre local ne peuvent pas être lus :', error.message);
            treasureGiftItems = [];
            treasureGiftCount = 0;
            treasureGiftResetAt = Date.now();
            treasureGiftServerResetAt = 0;
        }
    }

    function saveTreasureGifts() {
        if (!treasureOwner) return;
        try {
            localStorage.setItem(TREASURE_STORAGE_PREFIX + treasureOwner.toLowerCase(), JSON.stringify({
                total: treasureGiftCount,
                gifts: treasureGiftItems,
                liveRoomId: treasureLiveRoomId,
                resetAt: treasureGiftResetAt,
                serverResetAt: treasureGiftServerResetAt
            }));
        } catch (error) {
            console.warn('Les cadeaux du coffre ne peuvent pas être sauvegardés localement :', error.message);
        }
    }

    function setTreasureChestEnabled(enabled, owner, sourceUsername = '') {
        const nextOwner = String(owner || '');
        treasureSourceUsername = String(sourceUsername || '').trim().replace(/^@/, '').toLocaleLowerCase();
        const ownerChanged = nextOwner.toLowerCase() !== treasureOwner.toLowerCase();
        const nextEnabled = enabled === true && Boolean(nextOwner);
        if (ownerChanged) {
            treasureOwner = nextOwner;
            treasureGiftItems = [];
            treasureGiftCount = 0;
            readTreasureGifts(nextOwner);
        }
        treasureChestEnabled = nextEnabled;
        if (!treasureChestEnabled) {
            if (treasureStage) treasureStage.remove();
            treasureStage = null;
            return;
        }
        if (!treasureStage || !treasureStage.isConnected) ensureTreasureStage();
        applyTreasureLayout();
    }

    function setTreasureLayout(layout) {
        treasureLayout = normalizeTreasureLayout(layout);
        applyTreasureLayout();
    }

    function setTreasureEditPermission(canEdit) {
        treasureCanEdit = canEdit === true;
        applyTreasureLayout();
    }

    function saveTreasureLayout() {
        const layout = { ...treasureLayout };
        treasureLayoutSaving = true;
        fetch('/api/arcade-treasure-layout', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ layout })
        }).then(async response => {
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.message || 'Impossible d’enregistrer la position du coffre.');
            setTreasureLayout(result.layout);
            localStorage.setItem(TREASURE_LAYOUT_STORAGE_KEY, JSON.stringify({
                username: treasureOwner,
                layout: result.layout,
                updatedAt: Date.now()
            }));
        }).catch(error => {
            console.warn('La position du coffre n’a pas pu être enregistrée :', error.message);
        }).finally(() => {
            treasureLayoutSaving = false;
        });
    }

    function bindTreasureDrag(handle, mode) {
        handle.addEventListener('pointerdown', event => {
            if (!treasureEditIsRequested()) return;
            event.preventDefault();
            event.stopPropagation();
            handle.setPointerCapture(event.pointerId);
            treasureDragActive = true;
            const start = {
                x: event.clientX,
                y: event.clientY,
                layout: { ...treasureLayout }
            };
            const onMove = moveEvent => {
                if (!handle.hasPointerCapture(moveEvent.pointerId)) return;
                const deltaX = (moveEvent.clientX - start.x) / Math.max(1, window.innerWidth) * 100;
                const deltaY = (moveEvent.clientY - start.y) / Math.max(1, window.innerHeight) * 100;
                treasureLayout = mode === 'move'
                    ? normalizeTreasureLayout({
                        ...start.layout,
                        x: start.layout.x + deltaX,
                        y: start.layout.y + deltaY
                    })
                    : normalizeTreasureLayout({
                        ...start.layout,
                        width: start.layout.width + deltaX * 2
                    });
                applyTreasureLayout();
            };
            const onEnd = endEvent => {
                if (handle.hasPointerCapture(endEvent.pointerId)) handle.releasePointerCapture(endEvent.pointerId);
                handle.removeEventListener('pointermove', onMove);
                handle.removeEventListener('pointerup', onEnd);
                handle.removeEventListener('pointercancel', onEnd);
                treasureDragActive = false;
                saveTreasureLayout();
            };
            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onEnd);
            handle.addEventListener('pointercancel', onEnd);
        });
    }

    function addTreasureGift(gift, sourceUsername) {
        if (!treasureChestEnabled ||
            !treasureSourceUsername ||
            String(sourceUsername || '').toLocaleLowerCase() !== treasureSourceUsername) return;
        const messageId = gift.messageId && `treasure:${gift.messageId}`;
        if (messageId) {
            if (seenTreasureGifts.has(messageId)) return;
            seenTreasureGifts.add(messageId);
        }
        const repeatCount = Math.max(1, Math.floor(Number(gift.repeatCount) || 1));
        const safeCount = Math.min(repeatCount, Number.MAX_SAFE_INTEGER - treasureGiftCount);
        if (!safeCount) return;
        const item = {
            name: String(gift.giftName || gift.name || '').slice(0, 80),
            imageUrl: safeGiftImageUrl(gift.giftImageUrl || gift.giftImage || ''),
            count: safeCount
        };
        const existingIndex = treasureGiftItems.findIndex(existing =>
            item.name
                ? existing.name === item.name
                : !existing.name && existing.imageUrl === item.imageUrl
        );
        if (existingIndex >= 0) {
            const [existing] = treasureGiftItems.splice(existingIndex, 1);
            item.count = Math.min(Number.MAX_SAFE_INTEGER, existing.count + item.count);
        }
        treasureGiftItems.push(item);
        treasureGiftCount += safeCount;
        saveTreasureGifts();
        ensureTreasureStage();
        renderTreasureGifts();
        const items = treasureStage && treasureStage.querySelector('.ae-treasure-gifts');
        const bounds = treasureZoneBounds();
        const animatedSlots = new Set();
        const slots = treasurePileSlots(bounds);
        const firstSlot = (treasureGiftCount - safeCount) % slots.length;
        const animatedCount = Math.min(safeCount, slots.length);
        for (let offset = 0; offset < animatedCount; offset++) {
            animatedSlots.add((firstSlot + offset) % slots.length);
        }
        let animationIndex = 0;
        for (const slotIndex of animatedSlots) {
            const giftElement = items && items.querySelector(`[data-pile-slot="${slotIndex}"]`);
            if (!giftElement || typeof giftElement.animate !== 'function') continue;
            giftElement.getAnimations().forEach(animation => animation.cancel());
            const fallDistance = Math.max(180, window.innerHeight * 0.55);
            const drift = slots[slotIndex].x + slots[slotIndex].width / 2 -
                (bounds ? bounds.left + bounds.width / 2 : window.innerWidth / 2);
            giftElement.animate([
                {
                    transform: `translate(${-drift}px, ${-fallDistance}px) rotate(0deg) scale(.55)`,
                    opacity: 0,
                    offset: 0,
                    easing: 'cubic-bezier(.2,.7,.25,1)'
                },
                {
                    transform: `translate(${drift * 0.08}px, 6px) rotate(${drift < 0 ? -9 : 9}deg) scale(1.05)`,
                    opacity: 1,
                    offset: 0.86,
                    easing: 'cubic-bezier(.3,.7,.25,1)'
                },
                {
                    transform: 'translate(0, 0) rotate(0deg) scale(1)',
                    opacity: 1,
                    offset: 1,
                    easing: 'cubic-bezier(.3,.7,.25,1)'
                }
            ], {
                duration: 850 + Math.random() * 250,
                delay: Math.min(animationIndex++ * 55, 650),
                fill: 'none'
            });
        }
    }

    window.addEventListener('storage', event => {
        if (event.key && event.key.startsWith(TREASURE_STORAGE_PREFIX)) {
            if (!event.newValue || !treasureOwner ||
                event.key !== TREASURE_STORAGE_PREFIX + treasureOwner.toLowerCase()) return;
            try {
                const setting = JSON.parse(event.newValue);
                const hasNewServerReset = Number.isSafeInteger(setting.serverResetAt) &&
                    setting.serverResetAt > treasureGiftServerResetAt;
                const hasNewLocalReset = !Number.isSafeInteger(setting.serverResetAt) &&
                    Number.isSafeInteger(setting.resetAt) && setting.resetAt > treasureGiftResetAt;
                if ((hasNewServerReset || hasNewLocalReset) &&
                    Array.isArray(setting.gifts) && setting.gifts.length === 0 && setting.total === 0) {
                    treasureGiftCount = 0;
                    treasureGiftItems = [];
                    treasureGiftResetAt = Math.max(Date.now(), treasureGiftResetAt + 1);
                    if (hasNewServerReset) treasureGiftServerResetAt = setting.serverResetAt;
                    seenTreasureGifts.clear();
                    saveTreasureGifts();
                    renderTreasureGifts();
                }
            } catch (error) {
                console.warn('La remise à zéro du coffre reçue est invalide :', error.message);
            }
            return;
        }
        if (!event.newValue) return;
        try {
            if (event.key === 'ga-arcade-treasure-setting') {
                const setting = JSON.parse(event.newValue);
                if (setting.username && setting.username.toLowerCase() === treasureOwner.toLowerCase()) {
                    setTreasureChestEnabled(setting.enabled, setting.username, treasureSourceUsername);
                }
            } else if (event.key === TREASURE_LAYOUT_STORAGE_KEY) {
                const setting = JSON.parse(event.newValue);
                if (setting.username?.toLowerCase() === treasureOwner.toLowerCase()) {
                    setTreasureLayout(setting.layout);
                }
            } else if (event.key === TREASURE_EDIT_STORAGE_KEY) {
                applyTreasureLayout();
            }
        } catch (error) {
            console.warn('Mise à jour du coffre reçue dans un format invalide :', error.message);
        }
    });

    /* ---------- avion en papier ---------- */
    function paperPlane() {
        ensureLayer();
        const plane = document.createElement('div');
        plane.className = 'ae-plane';
        plane.innerHTML = '<svg viewBox="0 0 64 64"><path d="M4 30 60 4 40 58 29 38z" fill="#fff"/>' +
            '<path d="M4 30 29 38 60 4z" fill="#dfe9ff"/><path d="M29 38 33 56 40 58 36 42z" fill="#b8c8ee"/>' +
            '<path d="M29 38 60 4" stroke="#9fb2de" stroke-width="1.5" fill="none"/></svg>';
        layer.appendChild(plane);
        const w = window.innerWidth, h = window.innerHeight;
        const y0 = h * (0.55 + Math.random() * 0.25), rise = h * (0.25 + Math.random() * 0.2);
        const steps = 12, frames = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = -250 + t * (w + 500);
            const y = y0 - rise * t + Math.sin(t * Math.PI * 3) * 18;
            const angle = -18 + Math.cos(t * Math.PI * 3) * 10;
            frames.push({ transform: `translate(${x}px,${y}px) rotate(${angle}deg)`, opacity: i === 0 || i === steps ? 0 : 0.8, offset: t });
        }
        const animation = plane.animate(frames, { duration: 6500, easing: 'linear' });
        animation.onfinish = () => plane.remove();
    }

    /* ---------- sons (synthétisés, aucun fichier audio) ---------- */
    let audio = null, master = null, noiseBuffer = null, soundUnlockButton = null;
    function hideSoundUnlockButton() {
        soundUnlockButton?.remove();
        soundUnlockButton = null;
    }

    function showSoundUnlockButton() {
        if (soundUnlockButton?.isConnected) return;
        injectStyle();
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ae-sound-unlock';
        button.textContent = '🔊 Activer les effets sonores';
        button.addEventListener('click', () => {
            if (!audio) return;
            audio.resume().then(() => {
                if (audio?.state === 'running') hideSoundUnlockButton();
            }).catch(error => {
                console.warn('Impossible d’activer les effets sonores.', error);
            });
        });
        (document.body || document.documentElement).appendChild(button);
        soundUnlockButton = button;
    }

    function getAudio() {
        if (!config.sound) return null;
        if (!audio) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) {
                console.warn('Les effets sonores ne sont pas pris en charge par ce navigateur.');
                return null;
            }
            try {
                audio = new Ctx();
                master = audio.createGain();
                master.gain.value = config.volume;
                master.connect(audio.destination);
                noiseBuffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
                const data = noiseBuffer.getChannelData(0);
                for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
            } catch (error) {
                audio = null;
                console.warn('Impossible de préparer les effets sonores.', error);
                return null;
            }
        }
        if (audio.state === 'suspended') {
            showSoundUnlockButton();
            audio.resume().then(() => {
                if (audio?.state === 'running') hideSoundUnlockButton();
            }).catch(error => {
                console.warn('Impossible de reprendre les effets sonores.', error);
            });
        }
        master.gain.value = config.volume;
        if (audio.state === 'running') hideSoundUnlockButton();
        return audio.state === 'running' ? audio : null;
    }
    ['pointerdown', 'keydown', 'touchstart'].forEach(name =>
        window.addEventListener(name, () => { getAudio(); }, { passive: true }));

    function out(ac, pan) {
        if (!ac.createStereoPanner) return master;
        const panner = ac.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        panner.connect(master);
        return panner;
    }

    function noise(ac, dest, start, duration, type, freq, gain) {
        const src = ac.createBufferSource(), filter = ac.createBiquadFilter(), amp = ac.createGain();
        src.buffer = noiseBuffer;
        filter.type = type; filter.frequency.value = freq;
        amp.gain.setValueAtTime(gain, start);
        amp.gain.exponentialRampToValueAtTime(0.001, start + duration);
        src.connect(filter); filter.connect(amp); amp.connect(dest);
        src.start(start, Math.random() * 0.5, duration + 0.05);
    }

    function tone(ac, dest, start, duration, from, to, gain, shape) {
        const osc = ac.createOscillator(), amp = ac.createGain();
        osc.type = shape || 'sine';
        osc.frequency.setValueAtTime(from, start);
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
        amp.gain.setValueAtTime(gain, start);
        amp.gain.exponentialRampToValueAtTime(0.001, start + duration);
        osc.connect(amp); amp.connect(dest);
        osc.start(start); osc.stop(start + duration + 0.05);
    }

    function soundPop(x) {
        const ac = getAudio();
        if (!ac) return;
        const t = ac.currentTime, dest = out(ac, (x / window.innerWidth) * 2 - 1);
        tone(ac, dest, t, 0.12, 900, 260, 0.5, 'sine');
        noise(ac, dest, t, 0.08, 'highpass', 2500, 0.35);
    }

    function soundBoom(x, power) {
        const ac = getAudio();
        if (!ac) return;
        const t = ac.currentTime, dest = out(ac, (x / window.innerWidth) * 2 - 1), k = power / 6;
        tone(ac, dest, t, 0.45, 150, 38, 0.9 * Math.min(1, k + 0.2), 'sine');
        noise(ac, dest, t, 0.35, 'lowpass', 1400, 0.7 * Math.min(1, k + 0.2));
        const scale = [880, 1047, 1319, 1568, 1760, 2093];
        for (let i = 0; i < 7; i++) {
            const at = t + 0.12 + Math.random() * 0.75;
            noise(ac, dest, at, 0.03, 'highpass', 5000, 0.25);
            if (i % 2 === 0) tone(ac, dest, at, 0.22, scale[Math.floor(Math.random() * scale.length)], scale[0], 0.09, 'triangle');
        }
    }

    function soundLaunch(x) {
        const ac = getAudio();
        if (!ac) return;
        const t = ac.currentTime, dest = out(ac, (x / window.innerWidth) * 2 - 1);
        tone(ac, dest, t, 0.6, 300, 1400, 0.12, 'sine');
        noise(ac, dest, t, 0.5, 'bandpass', 1800, 0.12);
    }

    function setSound(enabled, volume) {
        config.sound = !!enabled;
        if (typeof volume === 'number') config.volume = Math.max(0, Math.min(1, volume));
        if (!config.sound) hideSoundUnlockButton();
    }

    /* ---------- bulle + feu d'artifice ---------- */
    function setAvatar(orb, name, url) {
        orb.textContent = '';
        if (url) {
            const img = new Image();
            img.alt = '';
            img.referrerPolicy = 'no-referrer';
            img.onerror = () => setAvatar(orb, name, '');
            img.src = url;
            orb.appendChild(img);
        } else {
            const initial = document.createElement('div');
            initial.className = 'ae-initial';
            initial.textContent = (String(name || '?').replace(/^@/, '')[0] || '?').toUpperCase();
            orb.appendChild(initial);
        }
    }

    function giftBurst(options) {
        ensureLayer();
        const name = String((options && (options.username || options.nickname)) || '');
        const key = name.toLowerCase();
        const url = (options && options.avatarUrl) || avatars.get(key) || '';
        const bubble = document.createElement('div');
        bubble.className = 'ae-bubble';
        const orb = document.createElement('div');
        orb.className = 'ae-orb';
        setAvatar(orb, name, url);
        const label = document.createElement('div');
        label.className = 'ae-name';
        label.textContent = name ? '@' + name.replace(/^@/, '') : '';
        if (!name) label.hidden = true;
        bubble.append(orb, label);
        const h = window.innerHeight, w = window.innerWidth;
        const x = w * (0.18 + Math.random() * 0.64) - 44;
        const top = Math.max(70, h * 0.16);
        const travel = -(h + 130 - top);
        bubble.style.left = x + 'px';
        layer.appendChild(bubble);
        soundLaunch(x + 44);
        if (key) liveBubbles.set(key, orb);

        const sway = (Math.random() < 0.5 ? -1 : 1) * 26;
        const animation = bubble.animate([
            { transform: 'translate(0,0) scale(.6)', opacity: 0, offset: 0 },
            { transform: `translate(${sway}px,${travel * 0.3}px) scale(1)`, opacity: 1, offset: 0.25 },
            { transform: `translate(${-sway}px,${travel * 0.65}px) scale(1.04)`, opacity: 1, offset: 0.65 },
            { transform: `translate(0,${travel}px) scale(1.1)`, opacity: 1, offset: 1 }
        ], { duration: 3400, easing: 'ease-out', fill: 'forwards' });
        animation.onfinish = () => {
            const rect = orb.getBoundingClientRect();
            bubble.remove();
            if (liveBubbles.get(key) === orb) liveBubbles.delete(key);
            if (!options || options.fireworks !== false) {
                fireworks(rect.left + rect.width / 2, rect.top + rect.height / 2, true);
            }
        };
    }

    function fireworks(cx, cy, withPop) {
        ensureCanvas();
        if (withPop) soundPop(cx);
        const palette = ['#ff2e93', '#ffd400', '#2de2e6', '#7cff6b', '#ff7a00', '#b388ff', '#ffffff'];
        const burst = (x, y, count, power) => {
            soundBoom(x, power);
            if (config.confetti) {
                const colors = ['#ff2e93', '#ffd400', '#2de2e6', '#7cff6b', '#ff7a00', '#b388ff'];
                for (let i = 0; i < count; i++) {
                    const angle = Math.random() * Math.PI * 2, speed = power * (0.2 + Math.random() * 0.5);
                    particles.push({
                        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 3,
                        life: 0, max: 70 + Math.random() * 40, size: 6 + Math.random() * 6, rect: true,
                        rot: Math.random() * 6, spin: (Math.random() - 0.5) * 0.4,
                        color: colors[Math.floor(Math.random() * colors.length)]
                    });
                }
                return;
            }
            const color = palette[Math.floor(Math.random() * palette.length)];
            const alt = palette[Math.floor(Math.random() * palette.length)];
            for (let i = 0; i < count; i++) {
                const angle = (Math.PI * 2 * i) / count + Math.random() * 0.15;
                const speed = power * (0.55 + Math.random() * 0.6);
                particles.push({
                    x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                    life: 0, max: 85 + Math.random() * 45, size: 24 + Math.random() * 26,
                    color: i % 3 === 0 ? alt : color
                });
            }
        };
        if (config.confetti) {
            burst(cx, cy, 70, 22);
            setTimeout(() => burst(cx - 200 + Math.random() * 400, cy + Math.random() * 120, 40, 16), 260);
            if (!raf) raf = requestAnimationFrame(frame);
            return;
        }
        burst(cx, cy, 300, 74.4);
        setTimeout(() => burst(cx - 840 + Math.random() * 1680, cy - 360 + Math.random() * 720, 210, 55.2), 260);
        setTimeout(() => burst(cx - 1080 + Math.random() * 2160, cy + Math.random() * 840, 210, 50.4), 520);
        if (!raf) raf = requestAnimationFrame(frame);
    }

    function frame() {
        raf = 0;
        if (!ctx || !canvas || !canvas.isConnected) { particles = []; return; }
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        ctx.globalCompositeOperation = 'lighter';
        particles = particles.filter(p => p.life < p.max);
        for (const p of particles) {
            p.life++;
            p.vx *= 0.975; p.vy = p.vy * 0.975 + 0.075;
            p.x += p.vx; p.y += p.vy;
            const alpha = Math.max(0, 1 - p.life / p.max);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            if (p.rect) {
                p.rot += p.spin;
                ctx.globalCompositeOperation = 'source-over';
                ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
                ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
                ctx.restore();
                continue;
            }
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * (0.4 + alpha * 0.6), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        if (particles.length) raf = requestAnimationFrame(frame);
        else { canvas.remove(); canvas = null; }
    }

    /* ---------- écoute des messages TikTok ---------- */
    function firstSeen(id) {
        if (!id) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        if (seen.size > 500) seen.delete(seen.values().next().value);
        return true;
    }

    async function getMediaAlerts(owner) {
        const username = String(owner || '').trim().replace(/^@/, '').toLowerCase();
        if (!/^[a-z0-9._]{1,32}$/.test(username)) return null;
        const cached = mediaAlerts.get(username);
        if (cached && cached.expiresAt > Date.now()) return cached.alerts;
        if (mediaAlertRequests.has(username)) return mediaAlertRequests.get(username);

        const request = (async () => {
            try {
                const response = await fetch(
                    `/api/media-alerts?user=${encodeURIComponent(username)}`,
                    { credentials: 'same-origin', cache: 'no-store' }
                );
                if (!response.ok) throw new Error(`Alertes média HTTP ${response.status}`);
                const data = await response.json();
                const alerts = data.alerts || {};
                mediaAlerts.set(username, { alerts, expiresAt: Date.now() + 10000 });
                return alerts;
            } catch (error) {
                console.warn('Alertes média indisponibles :', error.message);
                return null;
            } finally {
                mediaAlertRequests.delete(username);
            }
        })();
        mediaAlertRequests.set(username, request);
        return request;
    }

    async function getMediaAlert(owner, event) {
        const alerts = await getMediaAlerts(owner);
        return alerts?.[event] || null;
    }

    function playMediaAlert(alert) {
        return new Promise(resolve => {
            const pending = Number(Boolean(alert.audioUrl)) + Number(Boolean(alert.videoUrl));
            if (!pending) { resolve(); return; }
            let remaining = pending;
            let finished = false;
            const finishItem = () => {
                if (finished || --remaining > 0) return;
                finished = true;
                clearTimeout(guard);
                if (mediaAlertVideo) {
                    mediaAlertVideo.pause();
                    mediaAlertVideo.removeAttribute('src');
                    mediaAlertVideo.style.display = 'none';
                    mediaAlertVideo.load();
                }
                if (mediaAlertAudio) {
                    mediaAlertAudio.pause();
                    mediaAlertAudio = null;
                }
                resolve();
            };
            const guard = setTimeout(() => {
                remaining = 1;
                finishItem();
            }, 120000);

            if (alert.audioUrl) {
                mediaAlertAudio = new Audio(alert.audioUrl);
                mediaAlertAudio.onended = mediaAlertAudio.onerror = finishItem;
                mediaAlertAudio.play().catch(error => {
                    console.warn('Lecture du son Niveau Fan Club impossible :', error.message);
                    finishItem();
                });
            }
            if (alert.videoUrl) {
                if (!mediaAlertVideo) {
                    mediaAlertVideo = document.createElement('video');
                    mediaAlertVideo.playsInline = true;
                    mediaAlertVideo.setAttribute('aria-hidden', 'true');
                    mediaAlertVideo.style.cssText =
                        'position:fixed;top:50%;left:50%;width:100vw;height:100vh;height:100dvh;' +
                        'transform:translate(-50%,-50%);object-fit:contain;display:none;' +
                        'z-index:2147483647;pointer-events:none;background:transparent';
                    document.documentElement.appendChild(mediaAlertVideo);
                }
                mediaAlertVideo.volume = Number.isFinite(alert.videoVolume)
                    ? Math.min(1, Math.max(0, alert.videoVolume))
                    : 1;
                mediaAlertVideo.style.width = `${Number.isFinite(alert.videoWidth) ? Math.min(150, Math.max(25, alert.videoWidth)) : 100}vw`;
                mediaAlertVideo.style.height = `${Number.isFinite(alert.videoHeight) ? Math.min(150, Math.max(25, alert.videoHeight)) : 100}dvh`;
                mediaAlertVideo.style.objectFit = alert.videoFit === 'cover' ? 'cover' : 'contain';
                mediaAlertVideo.src = alert.videoUrl;
                mediaAlertVideo.style.display = 'block';
                mediaAlertVideo.onended = mediaAlertVideo.onerror = finishItem;
                mediaAlertVideo.play().catch(error => {
                    console.warn('Lecture de la vidéo Niveau Fan Club impossible :', error.message);
                    finishItem();
                });
            }
        });
    }

    function enqueueMediaAlert(alert, limit = Infinity) {
        if (mediaAlertQueue.length >= limit) {
            console.warn('Alerte média ignorée : la file de lecture est pleine.');
            return;
        }
        mediaAlertQueue.push(alert);
        if (mediaAlertPlaying) return;
        mediaAlertPlaying = true;
        void (async () => {
            try {
                while (mediaAlertQueue.length) await playMediaAlert(mediaAlertQueue.shift());
            } finally {
                mediaAlertPlaying = false;
            }
        })();
    }

    async function showLevelUp(data) {
        const levelUp = data.levelUp || {};
        const eventId = levelUp.messageId ? `level-up:${levelUp.messageId}` : '';
        if (!firstSeen(eventId)) return;
        const alert = await getMediaAlert(data.sourceTikTokUsername || levelUp.sourceTikTokUsername, 'level_up');
        if (!alert || (!alert.audioUrl && !alert.videoUrl)) return;
        enqueueMediaAlert(alert, 20);
    }

    async function showBoboComment(data) {
        const commentData = data.commentData || {};
        const comment = String(commentData.comment || '');
        if (!/(?:^|[^\p{L}\p{N}_])bobo(?:$|[^\p{L}\p{N}_])/iu.test(comment)) return;
        const eventId = commentData.messageId ? `comment-bobo:${commentData.messageId}` : '';
        if (!firstSeen(eventId)) return;
        const alert = await getMediaAlert(data.sourceTikTokUsername, 'comment_bobo');
        if (!alert || (!alert.audioUrl && !alert.videoUrl)) return;
        enqueueMediaAlert(alert);
    }

    function handle(data) {
        if (!data || typeof data !== 'object') return;
        if (data.type === 'LIVE_END' || data.type === 'LIVE_STATE') {
            handleTreasureLiveState(data);
        } else if (data.type === 'level-up' && data.levelUp && !data.suppressInGameMediaAlert) {
            void showLevelUp(data);
        } else if (data.type === 'comment' && data.commentData && !data.suppressInGameMediaAlert) {
            void showBoboComment(data);
        } else if (data.type === 'share') {
            const share = data.shareData || {};
            if (firstSeen(share.messageId && 'share:' + share.messageId)) paperPlane();
        } else if (data.type === 'gift' && data.gift) {
            const gift = data.gift;
            addTreasureGift(gift, data.sourceTikTokUsername);
            const coins = Number(gift.coinCount) || (Number(gift.coinValue ?? gift.diamondCount ?? gift.diamonds) || 0) * (Number(gift.repeatCount) || 1);
            if (!bigGiftOverlayEnabled || coins < config.bigGiftCoins ||
                !firstSeen(gift.messageId && 'gift:' + gift.messageId)) return;
            const name = gift.uniqueId || gift.username || gift.nickname || '';
            giftBurst({
                username: name,
                avatarUrl: gift.avatarDataUri || gift.avatarUrl || '',
                fireworks: bigGiftFireworksEnabled
            });
        } else if (data.type === 'viewer' && data.viewer) {
            const viewer = data.viewer;
            const url = viewer.avatarDataUri || '';
            if (!url) return;
            for (const id of [viewer.uniqueId, viewer.username, viewer.nickname]) {
                if (!id) continue;
                const key = String(id).toLowerCase();
                avatars.set(key, url);
                const orb = liveBubbles.get(key);
                if (orb && !orb.querySelector('img')) setAvatar(orb, id, url);
            }
            if (avatars.size > 200) avatars.delete(avatars.keys().next().value);
        }
    }

    function onMessage(event) {
        const raw = event.data;
        if (typeof raw !== 'string' || raw.length > 300000 ||
            !/"type"\s*:\s*"(?:gift|share|viewer|comment|level-up|LIVE_END|LIVE_STATE)"/.test(raw)) return;
        try { handle(JSON.parse(raw)); } catch (error) { /* message non JSON */ }
    }

    const NativeWebSocket = window.WebSocket;
    if (typeof NativeWebSocket === 'function') {
        window.WebSocket = new Proxy(NativeWebSocket, {
            construct(target, args, newTarget) {
                const socket = Reflect.construct(target, args, newTarget === window.WebSocket ? target : newTarget);
                const socketAddress = String(args[0] || '');
                if (!/\/(?:media-overlay-relay|live-tts-relay)(?:[?#]|$)/.test(socketAddress)) {
                    socket.addEventListener('message', onMessage);
                }
                return socket;
            }
        });
    }

    /* ---------- Import / export / sauvegarde (tout bloc [data-save-key]) ---------- */
    const SAVE_FORMAT = 'griffon-arcade-save', SAVE_MAX = 2000000;
    function readSave(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
    function backupNow(key) {
        const raw = readSave(key);
        if (!raw) return false;
        try { localStorage.setItem(key + '-backup', JSON.stringify({ at: Date.now(), data: raw })); return true; } catch (e) { return false; }
    }
    function exportSave(key) {
        const raw = readSave(key);
        if (!raw) return false;
        const file = JSON.stringify({ format: SAVE_FORMAT, game: key, exportedAt: new Date().toISOString(), data: JSON.parse(raw) }, null, 2);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([file], { type: 'application/json' }));
        a.download = `${key}-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        return true;
    }
    function importSave(key, text) {
        if (text.length > SAVE_MAX) throw new Error('Fichier trop volumineux.');
        const parsed = JSON.parse(text);
        if (!parsed || parsed.format !== SAVE_FORMAT || typeof parsed.data !== 'object' || parsed.data === null || Array.isArray(parsed.data)) throw new Error('Fichier de sauvegarde invalide.');
        if (parsed.game !== key) throw new Error('Cette sauvegarde appartient à un autre jeu.');
        backupNow(key);
        localStorage.setItem(key, JSON.stringify(parsed.data));
    }
    function mountSaveTools(box) {
        const key = box.dataset.saveKey;
        if (!key || box.dataset.ready) return;
        box.dataset.ready = '1';
        box.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px';
        const msg = document.createElement('div');
        msg.style.cssText = 'grid-column:1/-1;font-size:11px;opacity:.85;min-height:14px';
        const make = (label, fn) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'btn alt'; b.textContent = label; b.addEventListener('click', fn);
            box.appendChild(b); return b;
        };
        const say = t => { msg.textContent = t; };
        const file = document.createElement('input');
        file.type = 'file'; file.accept = 'application/json,.json'; file.hidden = true;
        file.addEventListener('change', async () => {
            const f = file.files && file.files[0]; file.value = '';
            if (!f) return;
            try { importSave(key, await f.text()); say('Import réussi, rechargement…'); setTimeout(() => location.reload(), 600); }
            catch (e) { say('Import impossible : ' + e.message); }
        });
        make('💾 Exporter', () => say(exportSave(key) ? 'Sauvegarde exportée.' : 'Rien à exporter pour le moment.'));
        make('📂 Importer', () => file.click());
        make('🛟 Sauvegarder', () => say(backupNow(key) ? 'Sauvegarde locale faite.' : 'Rien à sauvegarder.'));
        make('↩ Restaurer', () => {
            let b = null; try { b = JSON.parse(localStorage.getItem(key + '-backup')); } catch (e) { }
            if (!b || typeof b.data !== 'string') { say('Aucune sauvegarde locale.'); return; }
            if (!confirm('Restaurer la sauvegarde du ' + new Date(b.at).toLocaleString('fr-FR') + ' ?')) return;
            localStorage.setItem(key, b.data); location.reload();
        });
        box.append(file, msg);
    }
    function initSaveTools() { document.querySelectorAll('[data-save-key]').forEach(mountSaveTools); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSaveTools); else initSaveTools();

    window.ArcadeEffects = {
        config, paperPlane, giftBurst, fireworks, setSound, handleMessage: handle,
        setTreasureChestEnabled,
        simulateShare: () => handle({ type: 'share', shareData: { messageId: '' } }),
        simulateBigGift: (username, coins) => handle({ type: 'gift', gift: { messageId: '', uniqueId: username || 'spectateur', coinCount: coins || config.bigGiftCoins } }),
        simulateLevelUp: (username, level = 2) => handle({
            type: 'level-up',
            sourceTikTokUsername: username,
            levelUp: {
                messageId: `simulation:${Date.now()}`,
                uniqueId: 'spectateur_test',
                username: 'spectateur_test',
                nickname: 'Spectateur test',
                teamMemberLevel: level
            }
        })
    };
})();
