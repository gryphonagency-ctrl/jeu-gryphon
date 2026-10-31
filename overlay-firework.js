// Feu d'artifice d'overlay : fusée -> éclatement en deux anneaux (icônes du cadeau + étoiles) -> pseudo néon -> chute en fondu.
(function () {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:5';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const effects = [];
    const imageCache = new Map();
    const MAX_EFFECTS = 6;
    const ROCKET = 0.9, BURST = 0.9, TOTAL = 3.6;

    function resize() {
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.round(innerWidth * ratio);
        canvas.height = Math.round(innerHeight * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    addEventListener('resize', resize);
    resize();

    function loadImage(url) {
        if (!url) return null;
        if (imageCache.has(url)) return imageCache.get(url);
        const image = new Image();
        image.referrerPolicy = 'no-referrer';
        image.onerror = () => { image.failed = true; };
        image.src = url;
        imageCache.set(url, image);
        if (imageCache.size > 60) imageCache.delete(imageCache.keys().next().value);
        return image;
    }

    const easeOut = t => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);

    function drawStar(x, y, size, rotation) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
            const radius = i % 2 ? size * 0.45 : size;
            const angle = Math.PI / 5 * i - Math.PI / 2;
            ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        ctx.closePath();
        ctx.fillStyle = '#ffd93b';
        ctx.shadowColor = '#ffb300';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.restore();
    }

    function drawIcon(image, x, y, size, rotation) {
        if (image && image.complete && !image.failed && image.naturalWidth) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ctx.drawImage(image, -size, -size, size * 2, size * 2);
            ctx.restore();
        } else {
            drawStar(x, y, size, rotation);
        }
    }

    function drawName(text, x, y, size, alpha) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = `${size}px "Segoe Print","Bradley Hand","Comic Sans MS",cursive`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#ffe600';
        ctx.shadowBlur = size * 0.7;
        ctx.fillStyle = '#a8e632';
        ctx.fillText(text, x, y);
        ctx.shadowBlur = size * 0.25;
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    function frame(now) {
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        for (let i = effects.length - 1; i >= 0; i--) {
            const fx = effects[i];
            const t = (now - fx.start) / 1000;
            if (t >= TOTAL) { effects.splice(i, 1); continue; }
            const scale = Math.min(innerWidth, innerHeight);
            const radius = scale * 0.16;
            const iconSize = Math.max(10, scale * 0.028);
            if (t < ROCKET) {
                const p = easeOut(t / ROCKET);
                const y = innerHeight + 20 + (fx.y - innerHeight - 20) * p;
                const gradient = ctx.createLinearGradient(fx.x, y, fx.x, y + scale * 0.14);
                gradient.addColorStop(0, 'rgba(255,170,40,0.95)');
                gradient.addColorStop(1, 'rgba(255,120,0,0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(fx.x - 3, y, 6, scale * 0.14);
                drawIcon(fx.image, fx.x, y, iconSize * 1.2, 0);
                continue;
            }
            const b = t - ROCKET;
            const spread = easeOut(b / BURST);
            const fall = b > 1.2 ? Math.pow(b - 1.2, 2) * scale * 0.06 : 0;
            const alpha = b > 1.9 ? Math.max(0, 1 - (b - 1.9) / (TOTAL - ROCKET - 1.9)) : 1;
            ctx.save();
            ctx.globalAlpha = alpha;
            for (let k = 0; k < 12; k++) {
                const angle = Math.PI * 2 * k / 12 - Math.PI / 2;
                drawIcon(fx.image,
                    fx.x + Math.cos(angle) * radius * spread,
                    fx.y + Math.sin(angle) * radius * spread + fall,
                    iconSize, b * 2 * (k % 2 ? 1 : -1));
                const innerAngle = angle + Math.PI / 12;
                drawStar(
                    fx.x + Math.cos(innerAngle) * radius * 0.55 * spread,
                    fx.y + Math.sin(innerAngle) * radius * 0.55 * spread + fall,
                    iconSize * 0.55 * (1 - b * 0.12), b * 3);
            }
            ctx.restore();
            const nameAlpha = Math.min(1, Math.max(0, (b - 0.25) / 0.4)) * alpha;
            if (fx.name && nameAlpha > 0) drawName(fx.name, fx.x, fx.y + fall * 0.4, Math.max(18, scale * 0.07), nameAlpha);
        }
        if (effects.length) requestAnimationFrame(frame);
        else running = false;
    }

    let running = false;
    let audioContext = null;

    // Petit « pop » festif synthétisé (aucun fichier audio nécessaire).
    function pop(volume) {
        if (!volume) return;
        try {
            audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
            const start = audioContext.currentTime;
            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();
            oscillator.type = 'triangle';
            oscillator.frequency.setValueAtTime(520, start);
            oscillator.frequency.exponentialRampToValueAtTime(110, start + 0.35);
            gain.gain.setValueAtTime(volume, start);
            gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
            oscillator.connect(gain).connect(audioContext.destination);
            oscillator.start(start);
            oscillator.stop(start + 0.42);
        } catch (error) {
            console.warn('Son du feu d’artifice indisponible :', error);
        }
    }

    window.OverlayFirework = {
        launch({ name, imageUrl, volume = 0.15 }) {
            if (effects.length >= MAX_EFFECTS) return;
            effects.push({
                start: performance.now(),
                x: innerWidth * (0.25 + Math.random() * 0.5),
                y: innerHeight * (0.25 + Math.random() * 0.2),
                name: String(name || '').slice(0, 24),
                image: loadImage(imageUrl)
            });
            setTimeout(() => pop(volume), ROCKET * 1000);
            if (!running) { running = true; requestAnimationFrame(frame); }
        }
    };
})();
