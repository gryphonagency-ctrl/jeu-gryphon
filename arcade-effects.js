/*
 * Griffon Arcade — effets de live communs à tous les jeux.
 *  - partage du live      -> petit avion en papier discret
 *  - gros cadeau (>= 100) -> bulle et feu d'artifice, réglables par compte
 *  - cadeau reçu           -> son visuel réel est ajouté au coffre activable par compte
 * Le script écoute les WebSocket TikTok de la page : aucun jeu n'a besoin d'être modifié.
 */
(function () {
    'use strict';
    if (window.ArcadeEffects) return;

    const config = { bigGiftCoins: 100, sound: true, volume: 0.5 };
    const seen = new Set();
    const seenTreasureGifts = new Set();
    const avatars = new Map();
    const liveBubbles = new Map();
    let bigGiftOverlayEnabled = false;
    let bigGiftFireworksEnabled = false;
    let treasureChestEnabled = false;
    let treasureOwner = '';
    let treasureCanEdit = false;
    let treasureEditingEnabled = false;
    let treasureDragActive = false;
    let treasureLayoutSaving = false;
    let treasureGiftCount = 0;
    let treasureGiftItems = [];
    let treasureLayout = { x: 50, y: 82, width: 38 };
    let treasureStage = null;
    let layer = null, canvas = null, ctx = null, particles = [], raf = 0;

    async function refreshOverlaySettings() {
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
                setTreasureChestEnabled(settings.enabled === true, settings.owner || '');
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
                session.username || ''
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
        }
    }

    refreshOverlaySettings();
    setInterval(refreshOverlaySettings, 3000);

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
.ae-treasure-chest{position:absolute;max-width:90vw;max-height:72vh;object-fit:contain;z-index:2;user-select:none}
.ae-treasure-gifts{position:absolute;inset:0;z-index:3}
.ae-treasure-gift{position:absolute;width:clamp(8px,1.8vw,24px);height:clamp(8px,1.8vw,24px);display:flex;align-items:center;justify-content:center;
 overflow:visible;border:0;border-radius:0;background:transparent;box-shadow:none;will-change:transform}
.ae-treasure-gift img{width:100%;height:100%;object-fit:contain;filter:none}
.ae-treasure-gift-name{max-width:100%;padding:2px;color:#fff4cf;text-align:center;font:700 8px/1.1 Arial,sans-serif;overflow:hidden;overflow-wrap:anywhere}
.ae-treasure-gift-count{position:absolute;right:-4px;top:-5px;padding:1px 4px;border-radius:8px;background:#a51234;color:#fff;font:800 9px/1.2 Arial,sans-serif}
.ae-treasure-count{position:absolute;z-index:3;transform:translate(-50%,-50%);padding:4px 11px;border:1px solid #ffe27a;border-radius:99px;
 background:rgba(30,18,4,.78);color:#fff3b1;font:800 13px/1.2 Arial,sans-serif;text-shadow:0 1px 2px #000;white-space:nowrap}
.ae-treasure-handle{position:absolute;z-index:4;display:none;pointer-events:auto;touch-action:none;border:2px solid #fff3b1;border-radius:10px;
 background:rgba(24,18,10,.88);color:white;box-shadow:0 2px 10px rgba(0,0,0,.55);font:800 18px/1 Arial,sans-serif}
.ae-treasure-edit .ae-treasure-chest{outline:2px dashed #ffe27a;outline-offset:-10px;pointer-events:auto;cursor:move}
.ae-treasure-edit .ae-treasure-handle{display:grid;place-items:center}
.ae-treasure-move{width:42px;height:42px;cursor:move}
.ae-treasure-resize{width:38px;height:38px;cursor:nwse-resize}
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
    const TREASURE_CAPACITY = 36;
    const TREASURE_VISIBLE_LIMIT = 600;
    const DEFAULT_TREASURE_LAYOUT = { x: 50, y: 82, width: 38 };

    function normalizeTreasureLayout(layout) {
        if (!layout || !Number.isFinite(layout.x) || !Number.isFinite(layout.y) ||
            !Number.isFinite(layout.width)) return { ...DEFAULT_TREASURE_LAYOUT };
        return {
            x: Math.max(0, Math.min(100, layout.x)),
            y: Math.max(0, Math.min(100, layout.y)),
            width: Math.max(12, Math.min(90, layout.width))
        };
    }

    function treasureChestBounds() {
        const chest = treasureStage && treasureStage.querySelector('.ae-treasure-chest');
        if (!chest) return null;
        const bounds = chest.getBoundingClientRect();
        if (bounds.width && bounds.height) return bounds;
        const width = Math.min(
            window.innerWidth * treasureLayout.width / 100,
            window.innerWidth * 0.9,
            window.innerHeight * 0.72 * 1.75
        );
        const height = width / 1.75;
        const left = window.innerWidth * treasureLayout.x / 100 - width / 2;
        const top = window.innerHeight * treasureLayout.y / 100 - height / 2;
        return { left, top, right: left + width, bottom: top + height, width, height };
    }

    function treasureInsidePosition(index, bounds) {
        const seed = index + 1;
        if (!bounds || !bounds.width || !bounds.height) {
            return { x: window.innerWidth / 2, y: window.innerHeight - 40 };
        }
        return {
            x: bounds.left + bounds.width * (0.39 + ((seed * 31) % 29) / 100),
            y: bounds.top + bounds.height * (0.39 + ((seed * 17) % 5) / 100)
        };
    }

    function treasurePosition(index, bounds) {
        if (index < TREASURE_CAPACITY) {
            return treasureInsidePosition(index, bounds);
        }
        const seed = index + 1;
        const overflowIndex = index - TREASURE_CAPACITY;
        const side = overflowIndex % 2;
        return {
            x: Math.max(20, Math.min(window.innerWidth - 20,
                side ? bounds.right + 8 + ((seed * 13) % 32) : bounds.left - 8 - ((seed * 13) % 32))),
            y: window.innerHeight - 34 - ((seed * 11) % 5) * 8
        };
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
        const chest = document.createElement('img');
        chest.className = 'ae-treasure-chest';
        chest.src = '/images-vitrine/overlay-coffre-tresor.png';
        chest.alt = '';
        chest.title = 'Glisser pour déplacer le coffre';
        chest.draggable = false;
        chest.addEventListener('load', applyTreasureLayout);
        const count = document.createElement('div');
        count.className = 'ae-treasure-count';
        count.setAttribute('aria-live', 'polite');
        const moveHandle = document.createElement('button');
        moveHandle.className = 'ae-treasure-handle ae-treasure-move';
        moveHandle.type = 'button';
        moveHandle.textContent = '↕';
        moveHandle.setAttribute('aria-label', 'Déplacer le coffre');
        const resizeHandle = document.createElement('button');
        resizeHandle.className = 'ae-treasure-handle ae-treasure-resize';
        resizeHandle.type = 'button';
        resizeHandle.textContent = '↘';
        resizeHandle.setAttribute('aria-label', 'Redimensionner le coffre');
        treasureStage.append(gifts, chest, count, moveHandle, resizeHandle);
        layer.appendChild(treasureStage);
        bindTreasureDrag(chest, 'move');
        bindTreasureDrag(moveHandle, 'move');
        bindTreasureDrag(resizeHandle, 'resize');
        applyTreasureLayout();
        renderTreasureGifts();
    }

    function applyTreasureLayout() {
        if (!treasureStage || !treasureStage.isConnected) return;
        const chest = treasureStage.querySelector('.ae-treasure-chest');
        const count = treasureStage.querySelector('.ae-treasure-count');
        const moveHandle = treasureStage.querySelector('.ae-treasure-move');
        const resizeHandle = treasureStage.querySelector('.ae-treasure-resize');
        const x = `${treasureLayout.x}%`;
        const y = `${treasureLayout.y}%`;
        chest.style.left = x;
        chest.style.top = y;
        chest.style.width = `${treasureLayout.width}vw`;
        chest.style.transform = 'translate(-50%, -50%)';
        const chestBounds = treasureChestBounds();
        if (chestBounds) {
            count.style.left = `${chestBounds.left + chestBounds.width / 2}px`;
            count.style.top = `${chestBounds.bottom - 20}px`;
            moveHandle.style.left = `${chestBounds.left + 8}px`;
            moveHandle.style.top = `${chestBounds.top + 8}px`;
            resizeHandle.style.left = `${chestBounds.right - 46}px`;
            resizeHandle.style.top = `${chestBounds.bottom - 46}px`;
        } else {
            count.style.left = x;
            count.style.top = y;
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
        const count = treasureStage.querySelector('.ae-treasure-count');
        if (!container || !count) return;
        const bounds = treasureChestBounds();
        container.replaceChildren();
        const retainedCount = treasureGiftItems.reduce((total, gift) => total + gift.count, 0);
        const firstVisible = Math.max(0, treasureGiftCount - retainedCount);
        let localIndex = 0;
        for (const giftEntry of treasureGiftItems) {
            for (let repeatIndex = 0; repeatIndex < giftEntry.count; repeatIndex++) {
                const gift = { ...giftEntry, repeatIndex };
                const totalIndex = firstVisible + localIndex++;
                const item = document.createElement('span');
                const position = treasurePosition(totalIndex, bounds);
                item.className = `ae-treasure-gift${totalIndex >= TREASURE_CAPACITY ? ' ae-treasure-gift-overflow' : ''}`;
                item.style.left = `${position.x}px`;
                item.style.top = `${position.y}px`;
                item.title = gift.name || 'Cadeau TikTok reçu';
                if (gift.imageUrl) {
                    const image = document.createElement('img');
                    image.src = gift.imageUrl;
                    image.alt = gift.name || 'Cadeau reçu';
                    image.loading = 'lazy';
                    image.referrerPolicy = 'no-referrer';
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
                if (gift.count > 1 && gift.repeatIndex === 0) {
                    const repeatBadge = document.createElement('span');
                    repeatBadge.className = 'ae-treasure-gift-count';
                    repeatBadge.textContent = String(gift.count);
                    item.appendChild(repeatBadge);
                }
                container.appendChild(item);
            }
        }
        count.textContent = `Cadeaux reçus : ${treasureGiftCount.toLocaleString('fr-FR')}`;
    }

    function readTreasureGifts(owner) {
        if (!owner) return;
        try {
            const stored = JSON.parse(localStorage.getItem(TREASURE_STORAGE_PREFIX + owner.toLowerCase()) || 'null');
            if (!stored || !Array.isArray(stored.gifts)) return;
            treasureGiftCount = Number.isSafeInteger(stored.total) && stored.total > 0 ? stored.total : 0;
            const gifts = stored.gifts
                .filter(gift => gift && typeof gift === 'object')
                .map(gift => ({
                    name: String(gift.name || '').slice(0, 80),
                    imageUrl: safeGiftImageUrl(gift.imageUrl),
                    count: Math.max(1, Math.min(TREASURE_VISIBLE_LIMIT, Math.floor(Number(gift.count) || 1)))
                }));
            let remaining = TREASURE_VISIBLE_LIMIT;
            treasureGiftItems = [];
            for (let index = gifts.length - 1; index >= 0 && remaining > 0; index--) {
                const gift = gifts[index];
                const retained = Math.min(gift.count, remaining);
                treasureGiftItems.unshift({ ...gift, count: retained });
                remaining -= retained;
            }
        } catch (error) {
            console.warn('Les cadeaux du coffre local ne peuvent pas être lus :', error.message);
            treasureGiftItems = [];
            treasureGiftCount = 0;
        }
    }

    function saveTreasureGifts() {
        if (!treasureOwner) return;
        try {
            localStorage.setItem(TREASURE_STORAGE_PREFIX + treasureOwner.toLowerCase(), JSON.stringify({
                total: treasureGiftCount,
                gifts: treasureGiftItems.slice(-TREASURE_VISIBLE_LIMIT)
            }));
        } catch (error) {
            console.warn('Les cadeaux du coffre ne peuvent pas être sauvegardés localement :', error.message);
        }
    }

    function setTreasureChestEnabled(enabled, owner) {
        const nextOwner = String(owner || '');
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

    function addTreasureGift(gift) {
        if (!treasureChestEnabled) return;
        const messageId = gift.messageId && `treasure:${gift.messageId}`;
        if (messageId) {
            if (seenTreasureGifts.has(messageId)) return;
            seenTreasureGifts.add(messageId);
            if (seenTreasureGifts.size > 500) seenTreasureGifts.delete(seenTreasureGifts.values().next().value);
        }
        const repeatCount = Math.max(1, Math.floor(Number(gift.repeatCount) || 1));
        const safeCount = Math.min(repeatCount, Number.MAX_SAFE_INTEGER - treasureGiftCount);
        if (!safeCount) return;
        const item = {
            name: String(gift.giftName || gift.name || '').slice(0, 80),
            imageUrl: safeGiftImageUrl(gift.giftImageUrl || gift.giftImage || ''),
            count: Math.min(safeCount, TREASURE_VISIBLE_LIMIT)
        };
        if (safeCount >= TREASURE_VISIBLE_LIMIT) treasureGiftItems = [item];
        else treasureGiftItems.push(item);
        treasureGiftCount += safeCount;
        let retainedCount = treasureGiftItems.reduce((total, giftItem) => total + giftItem.count, 0);
        while (retainedCount > TREASURE_VISIBLE_LIMIT) {
            const excess = retainedCount - TREASURE_VISIBLE_LIMIT;
            if (treasureGiftItems[0].count <= excess) {
                retainedCount -= treasureGiftItems.shift().count;
            } else {
                treasureGiftItems[0].count -= excess;
                retainedCount -= excess;
            }
        }
        saveTreasureGifts();
        ensureTreasureStage();
        renderTreasureGifts();
        const items = treasureStage && treasureStage.querySelector('.ae-treasure-gifts');
        const bounds = treasureChestBounds();
        const animatedCount = Math.min(safeCount, retainedCount);
        for (let i = 0; i < animatedCount; i++) {
            const index = treasureGiftCount - animatedCount + i;
            const firstVisible = Math.max(0, treasureGiftCount - retainedCount);
            const giftElement = items && items.children[index - firstVisible];
            if (!giftElement || typeof giftElement.animate !== 'function') continue;
            const target = treasurePosition(index, bounds);
            const landing = treasureInsidePosition(
                index < TREASURE_CAPACITY ? index : (index - TREASURE_CAPACITY) % TREASURE_CAPACITY,
                bounds
            );
            const landingOffsetX = landing.x - target.x;
            const landingOffsetY = landing.y - target.y;
            const fallDistance = Math.max(180, landing.y + 64);
            giftElement.animate([
                {
                    transform: `translate(${landingOffsetX}px, ${landingOffsetY - fallDistance}px) scale(.65)`,
                    opacity: 0,
                    offset: 0,
                    easing: 'cubic-bezier(.2,.7,.25,1)'
                },
                {
                    transform: `translate(${landingOffsetX}px, ${landingOffsetY}px) scale(1)`,
                    opacity: 1,
                    offset: index < TREASURE_CAPACITY ? 1 : .72,
                    easing: 'cubic-bezier(.3,.7,.25,1)'
                },
                ...(index < TREASURE_CAPACITY ? [] : [{
                    transform: 'translate(0, 0) scale(1)',
                    opacity: 1,
                    offset: 1
                }])
            ], {
                duration: index < TREASURE_CAPACITY
                    ? 700 + Math.random() * 300
                    : 1000 + Math.random() * 250,
                delay: Math.min(i * 24, 650),
                fill: 'both'
            });
        }
    }

    window.addEventListener('storage', event => {
        if (!event.newValue) return;
        try {
            if (event.key === 'ga-arcade-treasure-setting') {
                const setting = JSON.parse(event.newValue);
                if (setting.username && setting.username.toLowerCase() === treasureOwner.toLowerCase()) {
                    setTreasureChestEnabled(setting.enabled, setting.username);
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
    let audio = null, master = null, noiseBuffer = null;
    function getAudio() {
        if (!config.sound) return null;
        if (!audio) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return null;
            try {
                audio = new Ctx();
                master = audio.createGain();
                master.gain.value = config.volume;
                master.connect(audio.destination);
                noiseBuffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
                const data = noiseBuffer.getChannelData(0);
                for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
            } catch (error) { audio = null; return null; }
        }
        if (audio.state === 'suspended') audio.resume().catch(() => {});
        master.gain.value = config.volume;
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

    function handle(data) {
        if (!data || typeof data !== 'object') return;
        if (data.type === 'share') {
            const share = data.shareData || {};
            if (firstSeen(share.messageId && 'share:' + share.messageId)) paperPlane();
        } else if (data.type === 'gift' && data.gift) {
            const gift = data.gift;
            addTreasureGift(gift);
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
        if (typeof raw !== 'string' || raw.length > 300000 || !/"type"\s*:\s*"(?:gift|share|viewer)"/.test(raw)) return;
        try { handle(JSON.parse(raw)); } catch (error) { /* message non JSON */ }
    }

    const NativeWebSocket = window.WebSocket;
    if (typeof NativeWebSocket === 'function') {
        window.WebSocket = new Proxy(NativeWebSocket, {
            construct(target, args, newTarget) {
                const socket = Reflect.construct(target, args, newTarget === window.WebSocket ? target : newTarget);
                socket.addEventListener('message', onMessage);
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
        simulateBigGift: (username, coins) => handle({ type: 'gift', gift: { messageId: '', uniqueId: username || 'spectateur', coinCount: coins || config.bigGiftCoins } })
    };
})();
