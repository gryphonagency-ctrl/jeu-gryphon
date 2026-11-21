import { CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from "three";

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 400;

export function createPrizeCardLabel({ username, amount, avatarUrl, width, height, depth, onAvatarError }) {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Impossible de créer l’affichage de la carte.");
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const geometry = new PlaneGeometry(width * 0.96, height * 0.96);
    const material = new MeshBasicMaterial({ map: texture, toneMapped: false });
    const group = new Group();
    for (const direction of [1, -1]) {
        const face = new Mesh(geometry, material);
        face.rotation.x = direction * Math.PI / 2;
        face.position.y = direction * (depth / 2 + 0.001);
        face.renderOrder = 2;
        face.castShadow = false;
        face.receiveShadow = false;
        group.add(face);
    }
    let active = true;
    let avatarRequest = 0;

    function draw(image) {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        context.save();
        context.beginPath();
        context.arc(132, 200, 94, 0, Math.PI * 2);
        context.clip();
        if (image) {
            const size = Math.min(image.naturalWidth, image.naturalHeight);
            context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2,
                size, size, 38, 106, 188, 188);
        } else {
            context.fillStyle = "#e5e5e5";
            context.fillRect(38, 106, 188, 188);
            context.fillStyle = "#000000";
            context.font = "bold 100px sans-serif";
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText("?", 132, 200);
        }
        context.restore();
        context.fillStyle = "#000000";
        context.textAlign = "left";
        context.textBaseline = "middle";
        context.font = "900 104px sans-serif";
        context.fillText(`${amount.toLocaleString("fr-FR")} ★`, 260, 145, 350);
        context.font = "bold 56px sans-serif";
        context.fillText(`@${username}`, 260, 250, 350);
        texture.needsUpdate = true;
    }

    function setAvatarUrl(url) {
        if (!/^(?:data:image\/(?:jpeg|png|webp);base64,|https?:\/\/|\/(?!\/))/i.test(url)) {
            onAvatarError(new Error("Adresse de photo de profil invalide."));
            return;
        }
        const request = ++avatarRequest;
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.addEventListener("load", () => {
            if (active && request === avatarRequest) draw(image);
        }, { once: true });
        image.addEventListener("error", () => {
            if (active && request === avatarRequest) onAvatarError(new Error("Photo de profil impossible à charger."));
        }, { once: true });
        image.src = url;
    }

    draw(null);
    if (avatarUrl) setAvatarUrl(avatarUrl);
    return {
        group,
        setAvatarUrl(url) {
            setAvatarUrl(url);
            return true;
        },
        dispose() {
            active = false;
            group.removeFromParent();
            geometry.dispose();
            material.dispose();
            texture.dispose();
        }
    };
}

export async function lookupPrizeAvatar(username) {
    const handle = String(username || "").trim().replace(/^@/, "");
    if (!/^[a-zA-Z0-9._]{1,32}$/.test(handle)) {
        throw new RangeError("Pseudo TikTok invalide pour la photo de profil.");
    }
    let lastStatus = 0;
    let data = null;
    for (let attempt = 0; attempt < 5 && !data; attempt++) {
        if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        const response = await fetch(`/api/tiktok-stars?player=${encodeURIComponent(handle)}`, {
            credentials: "same-origin",
            cache: "no-store"
        });
        lastStatus = response.status;
        if (!response.ok) continue;
        data = await response.json();
    }
    if (!data) throw new Error(`Profil TikTok indisponible (HTTP ${lastStatus}).`);
    if (!data.player?.avatarUrl) throw new Error("Aucune photo de profil disponible pour ce pseudo.");
    return data.player.avatarUrl;
}
