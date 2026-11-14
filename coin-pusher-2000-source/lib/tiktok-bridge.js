const RELAY_URL = "wss://jeu6boite.onrender.com";
const RECONNECT_DELAY = 3000;
const MAX_DEMO_COINS = 44000;
const MAX_TIKTOK_GIFT_COINS = 44000;
const SETUP_STORAGE_KEY = "coin-pusher-2000-live-panel-v1";
const SETUP_FORMAT = "coin-pusher-2000-control-panel";
const MAX_SETUP_FILE_BYTES = 2000000;
const MAX_SETUP_VIDEO_BYTES = 1300000;
const MAX_SETUP_VIDEO_DATA_URL_LENGTH = 1800000;
const IS_LOCAL_PREVIEW = location.hostname === "localhost" || location.hostname === "127.0.0.1";

export default function initializeTikTokBridge({ receiveGift, updateGiftAvatar, getPendingCoins, startGame, setScreenVideo, setCharacterScale }) {
    const usernameInput = document.getElementById("tiktok-username");
    const connectButton = document.getElementById("connect-tiktok");
    const statusElement = document.getElementById("live-status");
    const pendingElement = document.getElementById("pending-coins");
    const demoCountInput = document.getElementById("demo-count");
    const testGiftButton = document.getElementById("test-gift");
    const videoInput = document.getElementById("screen-video");
    const clearVideoButton = document.getElementById("clear-screen-video");
    const videoStatusElement = document.getElementById("video-status");
    const characterScaleInput = document.getElementById("character-scale");
    const characterScaleValue = document.getElementById("character-scale-value");
    const toggleButton = document.getElementById("toggle-live-panel");
    const panel = document.getElementById("live-panel");
    const panelHeader = document.getElementById("live-panel-header");
    const panelResizeHandle = document.getElementById("panel-resize-handle");
    const showPanelButton = document.getElementById("show-live-panel");
    const saveSetupButton = document.getElementById("save-setup");
    const restoreSetupButton = document.getElementById("restore-setup");
    const exportSetupButton = document.getElementById("export-setup");
    const importSetupButton = document.getElementById("import-setup");
    const setupImportInput = document.getElementById("setup-import-file");
    const setupStatusElement = document.getElementById("setup-status");
    let socket;
    let reconnectTimer;
    let activeVideoUrl = null;
    let activeVideoName = "";
    let activeVideoDataUrl = "";
    const retiredVideoUrls = new Set();
    let panelBounds;
    let panelDrag;
    let panelResize;
    let setupPersistTimer = 0;
    let setupReloadPending = false;

    function setStatus(message, state = "") {
        statusElement.textContent = message;
        statusElement.dataset.state = state;
    }

    function setVideoStatus(message, state = "") {
        videoStatusElement.textContent = message;
        videoStatusElement.dataset.state = state;
    }

    function setSetupStatus(message, state = "") {
        setupStatusElement.textContent = message;
        setupStatusElement.dataset.state = state;
    }

    function getAvatarKey(profile) {
        const identity = profile.userId || profile.uniqueId || profile.username || profile.nickname;
        return String(identity || "").trim().replace(/^@/, "").toLocaleLowerCase().slice(0, 128);
    }

    function validateSetupRecord(record) {
        if (!record || typeof record !== "object" || Array.isArray(record) || record.version !== 1) {
            throw new Error("Format de setup non reconnu.");
        }
        const normalized = {
            version: 1,
            username: "",
            demoCount: 10,
            characterScalePercent: 100,
            panel: null,
            panelVisible: true,
            video: null
        };
        if (record.username !== undefined) {
            if (typeof record.username !== "string" || record.username.length > 32) {
                throw new Error("Pseudo TikTok invalide dans le setup.");
            }
            normalized.username = record.username.trim().replace(/^@/, "");
        }
        if (record.demoCount !== undefined) {
            if (!Number.isSafeInteger(record.demoCount) || record.demoCount < 1 || record.demoCount > MAX_DEMO_COINS) {
                throw new Error("Nombre de pièces de simulation invalide dans le setup.");
            }
            normalized.demoCount = record.demoCount;
        }
        if (record.characterScalePercent !== undefined) {
            if (!Number.isSafeInteger(record.characterScalePercent) || record.characterScalePercent < 50 || record.characterScalePercent > 250) {
                throw new Error("Taille du personnage invalide dans le setup.");
            }
            normalized.characterScalePercent = record.characterScalePercent;
        }
        if (record.panel !== undefined && record.panel !== null) {
            const keys = ["left", "top", "width", "height"];
            if (
                typeof record.panel !== "object" ||
                Array.isArray(record.panel) ||
                !keys.every(key => Number.isFinite(record.panel[key])) ||
                record.panel.width <= 0 ||
                record.panel.height <= 0
            ) {
                throw new Error("Position ou taille du panneau invalide dans le setup.");
            }
            normalized.panel = Object.fromEntries(keys.map(key => [key, record.panel[key]]));
        }
        if (record.panelVisible !== undefined) {
            if (typeof record.panelVisible !== "boolean") {
                throw new Error("État du panneau invalide dans le setup.");
            }
            normalized.panelVisible = record.panelVisible;
        }
        if (record.video !== undefined && record.video !== null) {
            if (
                typeof record.video !== "object" ||
                Array.isArray(record.video) ||
                typeof record.video.name !== "string" ||
                record.video.name.length > 255
            ) {
                throw new Error("Vidéo du setup invalide.");
            }
            const dataUrl = record.video.dataUrl;
            if (
                dataUrl !== undefined &&
                dataUrl !== null &&
                (typeof dataUrl !== "string" ||
                    dataUrl.length > MAX_SETUP_VIDEO_DATA_URL_LENGTH ||
                    !/^data:video\/[a-z0-9.+-]+;base64,/i.test(dataUrl))
            ) {
                throw new Error("Données vidéo du setup invalides ou trop volumineuses.");
            }
            normalized.video = {
                name: record.video.name,
                dataUrl: dataUrl || null
            };
        }
        return normalized;
    }

    function readSetupRecord() {
        try {
            const raw = localStorage.getItem(SETUP_STORAGE_KEY);
            return raw ? validateSetupRecord(JSON.parse(raw)) : validateSetupRecord({ version: 1 });
        } catch (error) {
            console.error("Impossible de lire le setup enregistré :", error);
            setSetupStatus(`Setup local illisible : ${error.message}`);
            return validateSetupRecord({ version: 1 });
        }
    }

    function clamp(value, minimum, maximum) {
        return Math.min(Math.max(value, minimum), maximum);
    }

    function setPanelBounds(bounds) {
        const maxWidth = Math.max(160, window.innerWidth - 16);
        const minWidth = Math.min(240, maxWidth);
        const width = clamp(bounds.width, minWidth, maxWidth);
        const maxHeight = Math.max(120, window.innerHeight - 16);
        const minHeight = Math.min(180, maxHeight);
        const height = clamp(bounds.height, minHeight, maxHeight);
        const left = clamp(bounds.left, 8, Math.max(8, window.innerWidth - width - 8));
        const top = clamp(bounds.top, 8, Math.max(8, window.innerHeight - height - 8));
        panelBounds = { left, top, width, height };
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.right = "auto";
        panel.style.width = `${width}px`;
        panel.style.height = `${height}px`;
    }

    function setPanelVisible(visible, shouldSave = true) {
        panel.hidden = !visible;
        showPanelButton.hidden = visible;
        toggleButton.setAttribute("aria-expanded", String(visible));
        showPanelButton.setAttribute("aria-expanded", String(visible));
        if (shouldSave) {
            persistSetupRecord();
        }
    }

    function releaseRetiredVideoUrls() {
        retiredVideoUrls.forEach(url => {
            if (url.startsWith("blob:")) {
                URL.revokeObjectURL(url);
            }
        });
        retiredVideoUrls.clear();
    }

    function persistSetupRecord() {
        const demoCount = Number(demoCountInput.value);
        if (!Number.isSafeInteger(demoCount) || demoCount < 1 || demoCount > MAX_DEMO_COINS) {
            setSetupStatus(`Le nombre de simulation doit être compris entre 1 et ${MAX_DEMO_COINS.toLocaleString("fr-FR")}.`, "error");
            return false;
        }
        const characterScalePercent = Number(characterScaleInput.value);
        if (!Number.isSafeInteger(characterScalePercent) || characterScalePercent < 50 || characterScalePercent > 250) {
            setSetupStatus("La taille du personnage doit être comprise entre 50 % et 250 %.", "error");
            return false;
        }
        const record = {
            version: 1,
            username: usernameInput.value.trim().replace(/^@/, "").slice(0, 32),
            demoCount,
            characterScalePercent,
            panel: { ...panelBounds },
            panelVisible: !panel.hidden,
            video: activeVideoName
                ? { name: activeVideoName, dataUrl: activeVideoDataUrl || null }
                : null
        };
        try {
            localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(record));
            return true;
        } catch (error) {
            console.error("Impossible d’enregistrer le setup :", error);
            setSetupStatus("Sauvegarde impossible : espace local indisponible.", "error");
            return false;
        }
    }

    function scheduleSetupPersistence() {
        if (setupPersistTimer) {
            return;
        }
        setupPersistTimer = window.setTimeout(() => {
            setupPersistTimer = 0;
            persistSetupRecord();
        }, 400);
    }

    function prepareSetupReload() {
        setupReloadPending = true;
        if (setupPersistTimer) {
            clearTimeout(setupPersistTimer);
            setupPersistTimer = 0;
        }
    }

    function setupVideoExportNotice() {
        return activeVideoName && !activeVideoDataUrl
            ? ` La vidéo « ${activeVideoName} » n’est pas incluse; il faudra la sélectionner à nouveau après import.`
            : "";
    }

    const initialPanelRect = panel.getBoundingClientRect();
    panelBounds = {
        left: initialPanelRect.left,
        top: initialPanelRect.top,
        width: initialPanelRect.width,
        height: Math.min(initialPanelRect.height, window.innerHeight * 0.8)
    };
    const setupRecord = readSetupRecord();
    usernameInput.value = setupRecord.username;
    demoCountInput.value = String(setupRecord.demoCount);
    characterScaleInput.value = String(setupRecord.characterScalePercent);
    characterScaleValue.value = `${setupRecord.characterScalePercent} %`;
    setCharacterScale(setupRecord.characterScalePercent / 100);
    if (setupRecord.panel) {
        setPanelBounds(setupRecord.panel);
    } else {
        setPanelBounds(panelBounds);
    }
    setPanelVisible(setupRecord.panelVisible, false);
    if (setupRecord.video) {
        activeVideoName = setupRecord.video.name;
        activeVideoDataUrl = setupRecord.video.dataUrl || "";
        clearVideoButton.disabled = false;
        if (activeVideoDataUrl) {
            activeVideoUrl = activeVideoDataUrl;
            setScreenVideo(activeVideoUrl);
            setVideoStatus(`Restauration de « ${activeVideoName} »…`);
        } else {
            setVideoStatus(`« ${activeVideoName} » devra être re-sélectionnée après rechargement.`);
        }
    }

    function sendTikTokConnection(connection, username) {
        connection.send(JSON.stringify({ action: "CONNECT_TIKTOK", username }));
        startGame();
        setStatus(`Demande envoyée pour @${username} · en attente du bot.`);
    }

    function connectTikTok(username) {
        if (IS_LOCAL_PREVIEW) {
            setStatus("Aperçu local · la connexion TikTok live est disponible sur Griffon Arcade.", "error");
            return;
        }
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            connectRelay();
            return;
        }
        sendTikTokConnection(socket, username);
    }

    function handleMessage(data) {
        const type = String(data.type || "").toLowerCase();
        if (type === "status") {
            setStatus(String(data.message || "Statut du direct reçu."));
            return;
        }
        if (type === "viewer") {
            const viewer = data.viewer || data;
            const avatarKey = getAvatarKey(viewer);
            if (avatarKey && typeof viewer.avatarDataUri === "string") {
                updateGiftAvatar(avatarKey, viewer.avatarDataUri);
            }
            return;
        }
        if (type !== "gift" && type !== "tiktok-gift") {
            return;
        }
        const gift = data.gift || data;
        const count = Number(gift.coinCount ?? gift.count ?? gift.repeatCount ?? 1);
        if (!Number.isSafeInteger(count) || count < 1 || count > MAX_TIKTOK_GIFT_COINS) {
            setStatus(`Cadeau ignoré : nombre de pièces invalide (maximum ${MAX_TIKTOK_GIFT_COINS.toLocaleString("fr-FR")}).`, "error");
            return;
        }
        const avatarKey = getAvatarKey(gift);
        const queued = receiveGift(count, {
            avatarKey,
            avatarDataUri: typeof gift.avatarDataUri === "string" ? gift.avatarDataUri : ""
        });
        const username = String(gift.username || gift.nickname || "Spectateur");
        setStatus(`@${username} · ${queued.toLocaleString("fr-FR")} pièce${queued === 1 ? "" : "s"} ajoutée${queued === 1 ? "" : "s"} à la file.`);
    }

    function connectRelay() {
        clearTimeout(reconnectTimer);
        if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
            return;
        }
        const connection = new WebSocket(RELAY_URL);
        socket = connection;
        connection.addEventListener("open", () => {
            setStatus("Relais connecté · saisis le pseudo TikTok du direct.");
            const username = usernameInput.value.trim().replace(/^@/, "");
            if (username) {
                sendTikTokConnection(connection, username);
            }
        });
        connection.addEventListener("message", event => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch (error) {
                console.error("Événement TikTok invalide :", error);
                setStatus("Message du relais illisible · consulte la console.", "error");
                return;
            }
            handleMessage(data);
        });
        connection.addEventListener("error", () => {
            setStatus("Relais TikTok inaccessible · vérifie la connexion Internet.", "error");
        });
        connection.addEventListener("close", () => {
            if (socket === connection) {
                socket = null;
            }
            setStatus("Relais déconnecté · nouvelle tentative…");
            reconnectTimer = setTimeout(connectRelay, RECONNECT_DELAY);
        });
    }

    connectButton.addEventListener("click", () => {
        const username = usernameInput.value.trim().replace(/^@/, "");
        if (!username) {
            setStatus("Saisis ton pseudo TikTok.", "error");
            usernameInput.focus();
            return;
        }
        connectTikTok(username);
    });
    usernameInput.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            connectButton.click();
        }
    });
    testGiftButton.addEventListener("click", () => {
        const count = Number(demoCountInput.value);
        if (!Number.isSafeInteger(count) || count < 1 || count > MAX_DEMO_COINS) {
            setStatus(`Simulation limitée à ${MAX_DEMO_COINS.toLocaleString("fr-FR")} pièces.`, "error");
            return;
        }
        receiveGift(count);
        setStatus(`Simulation · ${count.toLocaleString("fr-FR")} pièces ajoutées à la file.`);
    });
    characterScaleInput.addEventListener("input", () => {
        const percent = Number(characterScaleInput.value);
        characterScaleValue.value = `${percent} %`;
        setCharacterScale(percent / 100);
        scheduleSetupPersistence();
    });
    videoInput.addEventListener("change", () => {
        const file = videoInput.files[0];
        videoInput.value = "";
        if (!file) {
            return;
        }
        if (
            !file.type.startsWith("video/") &&
            !/\.(mp4|m4v|mov|webm|ogv|ogg|avi|mkv|3gp|mpeg|mpg)$/i.test(file.name)
        ) {
            setVideoStatus("Choisis un fichier vidéo.", "error");
            return;
        }
        if (activeVideoUrl && activeVideoUrl.startsWith("blob:")) {
            retiredVideoUrls.add(activeVideoUrl);
        }
        const videoUrl = URL.createObjectURL(file);
        activeVideoUrl = videoUrl;
        activeVideoName = file.name;
        activeVideoDataUrl = "";
        clearVideoButton.disabled = false;
        setScreenVideo(activeVideoUrl);
        scheduleSetupPersistence();
        if (file.size > MAX_SETUP_VIDEO_BYTES) {
            setVideoStatus(`« ${file.name} » est affichée, mais dépasse 1,3 Mo et ne sera pas incluse dans l’export.`, "warning");
            return;
        }
        const reader = new FileReader();
        reader.addEventListener("load", () => {
            if (activeVideoUrl !== videoUrl) {
                return;
            }
            if (typeof reader.result !== "string") {
                setVideoStatus("La vidéo est affichée, mais ne peut pas être incluse dans le setup.", "warning");
                return;
            }
            activeVideoDataUrl = reader.result;
            if (persistSetupRecord()) {
                setVideoStatus(`« ${file.name} » est affichée et incluse dans le setup.`);
            }
        }, { once: true });
        reader.addEventListener("error", () => {
            if (activeVideoUrl !== videoUrl) {
                return;
            }
            console.error("Impossible de préparer la vidéo pour l’export :", reader.error);
            setVideoStatus("Vidéo affichée, mais impossible de l’inclure dans le setup.", "warning");
        }, { once: true });
        reader.readAsDataURL(file);
    });
    clearVideoButton.addEventListener("click", () => {
        if (activeVideoUrl && activeVideoUrl.startsWith("blob:")) {
            retiredVideoUrls.add(activeVideoUrl);
        }
        activeVideoUrl = null;
        activeVideoName = "";
        activeVideoDataUrl = "";
        videoInput.value = "";
        clearVideoButton.disabled = true;
        setScreenVideo(null);
        setVideoStatus("Vidéo retirée.");
        scheduleSetupPersistence();
    });
    window.addEventListener("message", event => {
        if (event.origin !== location.origin || !event.data) {
            return;
        }
        if (event.data.type === "screenVideoLoaded" && event.data.url === activeVideoUrl) {
            releaseRetiredVideoUrls();
            setVideoStatus(activeVideoDataUrl
                ? `« ${activeVideoName} » est affichée et incluse dans le setup.`
                : `« ${activeVideoName} » est affichée en boucle.`);
        }
        if (event.data.type === "screenVideoError" && event.data.url === activeVideoUrl) {
            setVideoStatus("Impossible de lire cette vidéo. Essaie un fichier MP4 ou WebM.", "error");
        }
        if (event.data.type === "screenVideoCleared") {
            releaseRetiredVideoUrls();
        }
    });
    function backupSetup(raw) {
        localStorage.setItem(`${SETUP_STORAGE_KEY}-backup`, JSON.stringify({
            savedAt: Date.now(),
            data: raw
        }));
    }

    saveSetupButton.addEventListener("click", () => {
        if (!persistSetupRecord()) {
            return;
        }
        try {
            const raw = localStorage.getItem(SETUP_STORAGE_KEY);
            if (!raw) {
                throw new Error("Aucun setup à sauvegarder.");
            }
            backupSetup(raw);
            setSetupStatus(`Setup sauvegardé sur cet appareil.${setupVideoExportNotice()}`, activeVideoName && !activeVideoDataUrl ? "warning" : "");
        } catch (error) {
            console.error("Échec de la sauvegarde du setup :", error);
            setSetupStatus(`Sauvegarde impossible : ${error.message}`, "error");
        }
    });
    restoreSetupButton.addEventListener("click", () => {
        try {
            const rawBackup = localStorage.getItem(`${SETUP_STORAGE_KEY}-backup`);
            const backup = rawBackup ? JSON.parse(rawBackup) : null;
            if (!backup || typeof backup.data !== "string") {
                setSetupStatus("Aucune sauvegarde locale à restaurer.", "error");
                return;
            }
            validateSetupRecord(JSON.parse(backup.data));
            if (!confirm(`Restaurer la sauvegarde du ${new Date(backup.savedAt).toLocaleString("fr-FR")} ?`)) {
                return;
            }
            localStorage.setItem(SETUP_STORAGE_KEY, backup.data);
            prepareSetupReload();
            location.reload();
        } catch (error) {
            console.error("Échec de la restauration du setup :", error);
            setSetupStatus(`Restauration impossible : ${error.message}`, "error");
        }
    });
    exportSetupButton.addEventListener("click", () => {
        if (!persistSetupRecord()) {
            return;
        }
        try {
            const raw = localStorage.getItem(SETUP_STORAGE_KEY);
            if (!raw) {
                throw new Error("Aucun setup à exporter.");
            }
            const payload = JSON.stringify({
                format: SETUP_FORMAT,
                game: SETUP_STORAGE_KEY,
                exportedAt: new Date().toISOString(),
                data: JSON.parse(raw)
            }, null, 2);
            if (new Blob([payload]).size > MAX_SETUP_FILE_BYTES) {
                throw new Error("Le setup dépasse la taille maximale d’export (2 Mo).");
            }
            const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = `${SETUP_STORAGE_KEY}-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 2000);
            setSetupStatus(`Setup exporté.${setupVideoExportNotice()}`, activeVideoName && !activeVideoDataUrl ? "warning" : "");
        } catch (error) {
            console.error("Échec de l’export du setup :", error);
            setSetupStatus(`Export impossible : ${error.message}`, "error");
        }
    });
    importSetupButton.addEventListener("click", () => setupImportInput.click());
    setupImportInput.addEventListener("change", async () => {
        const file = setupImportInput.files[0];
        setupImportInput.value = "";
        if (!file) {
            return;
        }
        try {
            if (file.size > MAX_SETUP_FILE_BYTES) {
                throw new Error("Fichier trop volumineux (maximum 2 Mo).");
            }
            const payload = JSON.parse(await file.text());
            if (
                !payload ||
                payload.format !== SETUP_FORMAT ||
                payload.game !== SETUP_STORAGE_KEY
            ) {
                throw new Error("Ce fichier n’est pas un setup compatible avec Coin Pusher 2000.");
            }
            const importedSetup = validateSetupRecord(payload.data);
            const serializedSetup = JSON.stringify(importedSetup);
            if (new Blob([serializedSetup]).size > MAX_SETUP_FILE_BYTES) {
                throw new Error("Les données du setup dépassent la taille maximale.");
            }
            const currentSetup = localStorage.getItem(SETUP_STORAGE_KEY);
            if (currentSetup) {
                backupSetup(currentSetup);
            }
            localStorage.setItem(SETUP_STORAGE_KEY, serializedSetup);
            prepareSetupReload();
            setSetupStatus("Import réussi, rechargement du setup…");
            window.setTimeout(() => location.reload(), 500);
        } catch (error) {
            console.error("Échec de l’import du setup :", error);
            setSetupStatus(`Import impossible : ${error.message}`, "error");
        }
    });
    usernameInput.addEventListener("input", scheduleSetupPersistence);
    demoCountInput.addEventListener("input", scheduleSetupPersistence);
    panelHeader.addEventListener("pointerdown", event => {
        if (event.button !== 0 || event.target.closest("button")) {
            return;
        }
        panelDrag = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: panelBounds.left,
            top: panelBounds.top
        };
        event.preventDefault();
    });
    panelResizeHandle.addEventListener("pointerdown", event => {
        if (event.button !== 0) {
            return;
        }
        panelResize = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            width: panelBounds.width,
            height: panelBounds.height
        };
        event.preventDefault();
    });
    function finishPanelAdjustment(event) {
        const dragged = panelDrag && panelDrag.pointerId === event.pointerId;
        const resized = panelResize && panelResize.pointerId === event.pointerId;
        if (!dragged && !resized) {
            return;
        }
        panelDrag = null;
        panelResize = null;
        persistSetupRecord();
    }
    window.addEventListener("pointermove", event => {
        if (panelDrag && panelDrag.pointerId === event.pointerId) {
            const rect = panel.getBoundingClientRect();
            setPanelBounds({
                left: panelDrag.left + event.clientX - panelDrag.x,
                top: panelDrag.top + event.clientY - panelDrag.y,
                width: rect.width,
                height: rect.height
            });
        }
        if (panelResize && panelResize.pointerId === event.pointerId) {
            setPanelBounds({
                ...panelBounds,
                width: panelResize.width + event.clientX - panelResize.x,
                height: panelResize.height + event.clientY - panelResize.y
            });
        }
    });
    window.addEventListener("pointerup", finishPanelAdjustment);
    window.addEventListener("pointercancel", finishPanelAdjustment);
    toggleButton.addEventListener("click", () => {
        setPanelVisible(false);
        showPanelButton.focus();
    });
    showPanelButton.addEventListener("click", () => {
        setPanelVisible(true);
        toggleButton.focus();
    });
    window.addEventListener("resize", () => {
        setPanelBounds(panelBounds);
        scheduleSetupPersistence();
    });
    window.addEventListener("pagehide", () => {
        if (setupReloadPending) {
            return;
        }
        if (setupPersistTimer) {
            clearTimeout(setupPersistTimer);
            setupPersistTimer = 0;
        }
        persistSetupRecord();
    });
    window.addEventListener("beforeunload", () => {
        if (activeVideoUrl && activeVideoUrl.startsWith("blob:")) {
            URL.revokeObjectURL(activeVideoUrl);
        }
        releaseRetiredVideoUrls();
    });

    window.setInterval(() => {
        pendingElement.textContent = getPendingCoins().toLocaleString("fr-FR");
    }, 250);
    if (IS_LOCAL_PREVIEW) {
        setStatus("Aperçu local · utilise la simulation; le live se connecte depuis Griffon Arcade.");
    } else {
        connectRelay();
    }
}
