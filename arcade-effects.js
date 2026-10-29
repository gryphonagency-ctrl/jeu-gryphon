/*
 * Griffon Arcade — effets de live communs à tous les jeux.
 *  - partage du live      -> petit avion en papier discret
 *  - gros cadeau (>= 100) -> photo de profil dans une bulle qui monte puis explose en feu d'artifice
 * Le script écoute les WebSocket TikTok de la page : aucun jeu n'a besoin d'être modifié.
 */
(function () {
    'use strict';
    if (window.ArcadeEffects) return;

    const config = { bigGiftCoins: 100, sound: true, volume: 0.5 };
    const seen = new Set();
    const avatars = new Map();
    const liveBubbles = new Map();
    let layer = null, canvas = null, ctx = null, particles = [], raf = 0;

    function injectStyle() {
        if (document.getElementById('arcade-effects-style')) return;
        const style = document.createElement('style');
        style.id = 'arcade-effects-style';
        style.textContent = `
#arcade-effects-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden}
#arcade-effects-layer canvas{position:absolute;inset:0;width:100%;height:100%}
.ae-plane{position:absolute;left:0;top:0;width:34px;height:34px;opacity:.8;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
.ae-plane svg{width:100%;height:100%;display:block}
.ae-bubble{position:absolute;bottom:-130px;width:88px;display:flex;flex-direction:column;align-items:center;gap:6px;will-change:transform,opacity}
.ae-bubble .ae-orb{position:relative;width:88px;height:88px;border-radius:50%;padding:5px;box-sizing:border-box;
 background:radial-gradient(circle at 30% 25%,rgba(255,255,255,.95),rgba(255,255,255,.25) 40%,rgba(120,200,255,.35));
 border:2px solid rgba(255,255,255,.85);box-shadow:0 0 18px rgba(120,200,255,.8),inset 0 0 14px rgba(255,255,255,.7)}
.ae-bubble .ae-orb img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}
.ae-bubble .ae-orb .ae-initial{width:100%;height:100%;border-radius:50%}
.ae-bubble .ae-initial{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#ff2e93,#ffb400);color:#fff;font:900 34px/1 Arial,sans-serif}
.ae-bubble .ae-name{max-width:150px;padding:2px 10px;border-radius:99px;background:rgba(0,0,0,.6);color:#fff;font:700 13px/1.4 Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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
        if (!canvas) return;
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(window.innerWidth * ratio);
        canvas.height = Math.round(window.innerHeight * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    window.addEventListener('resize', resizeCanvas);

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
            const x = -50 + t * (w + 100);
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
            fireworks(rect.left + rect.width / 2, rect.top + rect.height / 2, true);
        };
    }

    function fireworks(cx, cy, withPop) {
        ensureCanvas();
        if (withPop) soundPop(cx);
        const palette = ['#ff2e93', '#ffd400', '#2de2e6', '#7cff6b', '#ff7a00', '#b388ff', '#ffffff'];
        const burst = (x, y, count, power) => {
            soundBoom(x, power);
            const color = palette[Math.floor(Math.random() * palette.length)];
            const alt = palette[Math.floor(Math.random() * palette.length)];
            for (let i = 0; i < count; i++) {
                const angle = (Math.PI * 2 * i) / count + Math.random() * 0.15;
                const speed = power * (0.55 + Math.random() * 0.6);
                particles.push({
                    x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                    life: 0, max: 70 + Math.random() * 40, size: 2 + Math.random() * 2.2,
                    color: i % 3 === 0 ? alt : color
                });
            }
        };
        burst(cx, cy, 90, 6.2);
        setTimeout(() => burst(cx - 70 + Math.random() * 140, cy - 30 + Math.random() * 60, 60, 4.6), 260);
        setTimeout(() => burst(cx - 90 + Math.random() * 180, cy + Math.random() * 70, 60, 4.2), 520);
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
            const coins = Number(gift.coinCount) || (Number(gift.coinValue ?? gift.diamondCount ?? gift.diamonds) || 0) * (Number(gift.repeatCount) || 1);
            if (coins < config.bigGiftCoins || !firstSeen(gift.messageId && 'gift:' + gift.messageId)) return;
            const name = gift.uniqueId || gift.username || gift.nickname || '';
            giftBurst({ username: name, avatarUrl: gift.avatarDataUri || gift.avatarUrl || '' });
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
        simulateShare: () => handle({ type: 'share', shareData: { messageId: '' } }),
        simulateBigGift: (username, coins) => handle({ type: 'gift', gift: { messageId: '', uniqueId: username || 'spectateur', coinCount: coins || config.bigGiftCoins } })
    };
})();
