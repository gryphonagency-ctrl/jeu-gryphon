// ==========================================
// 1. CONFIGURATION & ÉTAT GLOBAL DU JEU
// ==========================================
const RECOMPENSES = [30, 50, 100, 1000, 10000, 0];
const BACKGROUND_STORAGE_KEY = 'six-boxes-background-v1';
const LEADERBOARD_POSITION_KEY = 'six-boxes-leaderboard-position-v1';
const GAME_STATE_STORAGE_KEY = 'six-boxes-game-state-v1';

function createDefaultGameState() {
  return {
    rtpRate: 6,
    forceNextWin: false,
    players: {},
    history: [],
    liveStats: { giftEvents: 0, giftCoins: 0, rewardCount: 0, rewardStars: 0 }
  };
}

function normalizeGameState(value) {
  const defaults = createDefaultGameState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;

  const liveStats = value.liveStats && typeof value.liveStats === 'object'
    ? value.liveStats
    : {};
  const validCount = count => Number.isSafeInteger(Number(count)) && Number(count) >= 0
    ? Number(count)
    : 0;

  return {
    ...defaults,
    ...value,
    rtpRate: Number.isFinite(Number(value.rtpRate))
      ? Math.min(100, Math.max(0, Number(value.rtpRate)))
      : defaults.rtpRate,
    players: value.players && typeof value.players === 'object' && !Array.isArray(value.players)
      ? value.players
      : {},
    history: Array.isArray(value.history) ? value.history.slice(-1000) : [],
    liveStats: {
      giftEvents: validCount(liveStats.giftEvents),
      giftCoins: validCount(liveStats.giftCoins),
      rewardCount: validCount(liveStats.rewardCount),
      rewardStars: validCount(liveStats.rewardStars)
    }
  };
}

function loadGameState() {
  try {
    const savedState = localStorage.getItem(GAME_STATE_STORAGE_KEY);
    return savedState ? normalizeGameState(JSON.parse(savedState)) : createDefaultGameState();
  } catch (error) {
    console.warn('Impossible de charger la sauvegarde du jeu :', error);
    return createDefaultGameState();
  }
}

let gameState = loadGameState();

let soundEnabled = true;
let ttsEnabled = true;

// Éléments du DOM
const rtpSlider = document.getElementById('rtpSlider');
const rtpValueDisplay = document.getElementById('rtpValue');
const giftMinInput = document.getElementById('giftMin');
const overlayBanner = document.getElementById('overlayBanner');
const winnerNameDisplay = document.getElementById('winnerName');
const winAmountDisplay = document.getElementById('winAmount');
const leaderboardBody = document.getElementById('leaderboardBody');
const chatBox = document.getElementById('chatBox');
const tiktokUsernameInput = document.getElementById('tiktokUsername');
const tiktokStatus = document.getElementById('tiktokStatus');

// Synchro initiale avec le curseur RTP
rtpSlider.addEventListener('input', (e) => {
  gameState.rtpRate = parseInt(e.target.value);
  rtpValueDisplay.innerText = gameState.rtpRate + '%';
  saveGameState();
});

function saveGameState() {
  try {
    localStorage.setItem(GAME_STATE_STORAGE_KEY, JSON.stringify(gameState));
  } catch (error) {
    console.warn('Impossible d’enregistrer les données du jeu :', error);
  }
}

function updateLiveStats() {
  const stats = gameState.liveStats;
  document.getElementById('statGiftEvents').textContent = stats.giftEvents.toLocaleString('fr-FR');
  document.getElementById('statGiftCoins').textContent = stats.giftCoins.toLocaleString('fr-FR');
  document.getElementById('statRewardCount').textContent = stats.rewardCount.toLocaleString('fr-FR');
  document.getElementById('statRewardStars').textContent = stats.rewardStars.toLocaleString('fr-FR');
}

function recordLiveGift(coinCount) {
  gameState.liveStats.giftEvents += 1;
  gameState.liveStats.giftCoins += coinCount;
  saveGameState();
  updateLiveStats();
}

// ==========================================
// 2. SYNTHÈSE VOCALE & EFFETS SONORES (TTS)
// ==========================================
function playAudio(type) {
  if (!soundEnabled) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  if (type === 'win') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } else if (type === 'fail') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  }
}

function speakText(text) {
  if (!ttsEnabled || !('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'fr-FR';
  utterance.rate = 1.0;
  utterance.pitch = 1.1;
  window.speechSynthesis.speak(utterance);
}

function testVoice() {
  speakText("Ceci est un test de la synthèse vocale pour le live TikTok !");
}

function toggleVoice() {
  ttsEnabled = !ttsEnabled;
  if (!ttsEnabled && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  const btn = document.getElementById('btnVoiceToggle');
  btn.innerText = ttsEnabled ? "🔊 Voix Active" : "🔇 Voix Désactivée";
  btn.classList.toggle('active', ttsEnabled);
}

// ==========================================
// 3. LOGIQUE DU JEU & ROULEMENT DES BOÎTES
// ==========================================
function processAction(username, giftCount, boxChoice, fromLive = false, isSpin = false) {
  const minGifts = parseInt(giftMinInput.value) || 100;

  // Commande de vérification de solde d'étoiles
  if (boxChoice === '*') {
    const total = gameState.players[username] || 0;
    addChatMessage(username, `* (Solde actuel : ${total} ⭐️)`);
    speakText(`${username}, tu as actuellement ${total} étoiles.`);
    return;
  }

  // Vérification de la commande 1 à 6
  const boxIndex = parseInt(boxChoice);
  if (isNaN(boxIndex) || boxIndex < 1 || boxIndex > 6) {
    return;
  }

  // Vérification du don minimum
  if (!isSpin && giftCount < minGifts) {
    addChatMessage("Système", `${username} a envoyé ${giftCount} pièces. (Minimum requis : ${minGifts})`);
    return;
  }

  addChatMessage(username, isSpin
    ? `utilise un spin et choisit la boîte ${boxIndex} !`
    : `a choisi la boîte ${boxIndex} avec un don de ${giftCount} pièces !`);

  // Calcul selon la probabilité RTP
  let isWin = false;
  if (gameState.forceNextWin) {
    isWin = true;
    gameState.forceNextWin = false;
  } else {
    const rand = Math.floor(Math.random() * 100) + 1;
    isWin = rand <= gameState.rtpRate;
  }

  triggerBoxAnimation(boxIndex, isWin, username, giftCount, fromLive, isSpin);
}

function triggerBoxAnimation(boxIndex, isWin, username, giftCount, fromLive, isSpin = false) {
  const boxElement = document.getElementById(`box-${boxIndex}`);
  boxElement.classList.add('opening');

  setTimeout(() => {
    boxElement.classList.remove('opening');

    if (isWin) {
      const reward = RECOMPENSES[boxIndex - 1];
      playAudio('win');

      if (reward > 0) {
        // Enregistrement du score
        gameState.players[username] = (gameState.players[username] || 0) + reward;
        if (fromLive) {
          if (window.ArcadeStars) {
            window.ArcadeStars.award({ username, amount: reward })
              .catch(error => console.error('Impossible d’ajouter les étoiles des Six Boîtes au solde global :', error));
          }
          gameState.liveStats.rewardCount += 1;
          gameState.liveStats.rewardStars += reward;
          gameState.history.push({
            username,
            giftCoins: giftCount,
            boxIndex,
            rewardStars: reward,
            isSpin,
            spinCost: isSpin ? 100 : 0,
            awardedAt: new Date().toISOString()
          });
          gameState.history = gameState.history.slice(-1000);
        }
        saveGameState();
        updateLeaderboard();
        updateLiveStats();

        // Affichage de la bannière overlay
        showWinnerBanner(username, reward, boxIndex);
        addChatMessage("Résultat", `Félicitations à ${username}. Il gagne ${reward} étoiles dans la boîte numéro ${boxIndex}.`);

        // Annonce Vocale
        speakText(`Félicitations à ${username}. Il gagne ${reward} étoiles dans la boîte numéro ${boxIndex}.`);
      } else {
        addChatMessage("Résultat", `La boîte ${boxIndex} contenait 0 pièce ! Échec.`);
        speakText(`Dommage pour ${username}, la boîte ${boxIndex} contenait zéro étoile.`);
      }
    } else {
      playAudio('fail');
      addChatMessage("Résultat", `La boîte ${boxIndex} n'a pas pu être ouverte (RTP non déclenché).`);
      speakText(`Dommage ${username}, la boîte ${boxIndex} résiste et ne s'ouvre pas !`);
    }
  }, 1000);
}

// ==========================================
// 4. AFFICHAGE DES BANNIÈRES ET BARS
// ==========================================
function showWinnerBanner(name, amount, boxIndex) {
  winnerNameDisplay.innerText = `Félicitations à ${name}.`;
  winAmountDisplay.innerText = `Il gagne ${amount} étoiles dans la boîte numéro ${boxIndex}.`;
  overlayBanner.classList.add('show');

  // Lancement des confettis
  createConfetti();

  setTimeout(() => {
    overlayBanner.classList.remove('show');
  }, 5000);
}

function createConfetti() {
  const colors = ['#f39c12', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6'];
  for (let i = 0; i < 40; i++) {
    const confetti = document.createElement('div');
    confetti.style.position = 'fixed';
    confetti.style.left = Math.random() * 100 + 'vw';
    confetti.style.top = '-10px';
    confetti.style.width = '10px';
    confetti.style.height = '10px';
    confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.zIndex = '9999';
    confetti.style.transition = 'transform 3s ease-out, opacity 3s ease-out';
    document.body.appendChild(confetti);

    setTimeout(() => {
      confetti.style.transform = `translateY(${window.innerHeight}px) rotate(${Math.random() * 360}deg)`;
      confetti.style.opacity = '0';
    }, 50);

    setTimeout(() => confetti.remove(), 3000);
  }
}

// ==========================================
// 5. CLASSEMENT & LOGS DU CHAT
// ==========================================
function updateLeaderboard() {
  leaderboardBody.innerHTML = '';
  const sorted = Object.entries(gameState.players)
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    leaderboardBody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#888;">Aucun gagnant pour le moment</td></tr>';
    return;
  }

  sorted.forEach(([name, stars], index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>#${index + 1}</b></td>
      <td>${escapeHtml(name)}</td>
      <td><b>${stars} ⭐️</b></td>
    `;
    leaderboardBody.appendChild(tr);
  });
}

function addChatMessage(author, text) {
  const msg = document.createElement('div');
  msg.className = 'chat-msg';
  msg.innerHTML = `<span>${escapeHtml(author)}:</span> ${escapeHtml(text)}`;
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ==========================================
// 6. TIKTOK LIVE CONNECTOR / WS
// ==========================================
let tiktokConnected = false;
let tiktokSocket = null;
let tiktokReconnectTimer = null;
const selectedBoxByUser = new Map();
const pendingGiftsByUser = new Map();
const pendingSpinsByUser = new Set();
const processedGiftIds = new Set();

function connectTikTok() {
  const username = tiktokUsernameInput.value.trim();
  if (!username) {
    alert("Veuillez saisir un nom d'utilisateur TikTok.");
    return;
  }

  clearTimeout(tiktokReconnectTimer);
  if (tiktokSocket) {
    tiktokSocket.onclose = null;
    tiktokSocket.close();
  }

  tiktokStatus.innerText = `Connexion au live de @${username}...`;
  tiktokStatus.style.color = "yellow";

  try {
    const socket = new WebSocket('wss://jeu6boite.onrender.com');
    tiktokSocket = socket;

    socket.addEventListener('open', () => {
      if (tiktokSocket !== socket) return;
      tiktokConnected = true;
      socket.send(JSON.stringify({ action: 'CONNECT_TIKTOK', username }));
      tiktokStatus.innerText = `Connecteur actif, connexion au live de @${username}...`;
      tiktokStatus.style.color = "#2ecc71";
      addChatMessage("Système", `Connexion au live TikTok de @${username} demandée.`);
    });

    socket.addEventListener('message', event => {
      try {
        handleTikTokMessage(JSON.parse(event.data));
      } catch (error) {
        console.error("Message TikTok invalide :", error);
      }
    });

    socket.addEventListener('error', () => {
      if (tiktokSocket !== socket) return;
      tiktokConnected = false;
      tiktokStatus.innerText = "Relais TikTok inaccessible (vérifiez serveur.js)";
      tiktokStatus.style.color = "#e74c3c";
    });

    socket.addEventListener('close', () => {
      if (tiktokSocket !== socket) return;
      tiktokConnected = false;
      tiktokStatus.innerText = "Reconnexion au relais TikTok...";
      tiktokStatus.style.color = "yellow";
      tiktokReconnectTimer = setTimeout(connectTikTok, 3000);
    });
  } catch (error) {
    tiktokConnected = false;
    tiktokStatus.innerText = `Connexion impossible : ${error.message}`;
    tiktokStatus.style.color = "#e74c3c";
  }
}

function handleTikTokMessage(data) {
  const type = String(data.type || '').toLowerCase();

  if (type === 'status') {
    tiktokStatus.innerText = data.message || "Statut TikTok reçu";
    return;
  }

  if (type === 'chat' || type === 'comment' || type === 'tiktok-comment') {
    const message = data.commentData || data;
    const username = String(message.username || message.uniqueId || 'Spectateur').trim();
    const comment = String(message.comment || message.content || message.text || '').trim();
    if (/^(?:!?\s*(?:étoile|etoile|star)s?|\*)$/iu.test(comment)) return;

    if (/^spin\s+100$/i.test(comment)) {
      const userKey = username.toLocaleLowerCase('fr-FR');
      const playerName = Object.keys(gameState.players).find(name =>
        name.toLocaleLowerCase('fr-FR') === userKey
      );
      const balance = playerName ? Number(gameState.players[playerName]) || 0 : 0;
      if (pendingSpinsByUser.has(userKey) || pendingGiftsByUser.get(userKey)?.length || selectedBoxByUser.has(userKey)) {
        addChatMessage('Spin', `@${username}, termine d’abord ton action en cours avant de lancer spin 100.`);
        return;
      }
      if (balance < 100) {
        addChatMessage('Spin', `@${username}, il te faut 100 étoiles pour utiliser spin 100. Solde : ${balance}.`);
        return;
      }

      gameState.players[playerName] = balance - 100;
      pendingSpinsByUser.add(userKey);
      saveGameState();
      updateLeaderboard();
      addChatMessage('Spin', `@${username}, spin 100 accepté : 100 étoiles dépensées. Choisis une boîte en commentant un numéro de 1 à 6.`);
      return;
    }

    if (/^spin(?:\s|$)/i.test(comment)) {
      addChatMessage('Spin', `@${username}, seule la commande « spin 100 » permet de rejouer.`);
      return;
    }

    if (/^[1-6]$/.test(comment)) {
      const userKey = username.toLocaleLowerCase('fr-FR');
      if (pendingSpinsByUser.delete(userKey)) {
        processAction(username, 0, comment, true, true);
        return;
      }

      const pendingGifts = pendingGiftsByUser.get(userKey);
      if (pendingGifts?.length) {
        const coinCount = pendingGifts.shift();
        if (pendingGifts.length === 0) pendingGiftsByUser.delete(userKey);
        processAction(username, coinCount, comment, true);
      } else {
        selectedBoxByUser.set(userKey, comment);
        addChatMessage(username, `a choisi la boîte ${comment}. Un cadeau de ${giftMinInput.value} pièces déclenchera l’ouverture.`);
      }
    }
    return;
  }

  if (type !== 'gift' && type !== 'tiktok-gift') return;

  const gift = data.gift || data;
  const messageId = String(gift.messageId || '');
  if (messageId && processedGiftIds.has(messageId)) return;
  if (messageId) {
    processedGiftIds.add(messageId);
    if (processedGiftIds.size > 5000) {
      processedGiftIds.delete(processedGiftIds.values().next().value);
    }
  }

  const coinCount = Number(gift.coinCount ?? gift.diamonds ?? gift.diamondCount);
  const username = String(gift.username || gift.nickname || 'Spectateur').trim();
  if (!Number.isSafeInteger(coinCount) || coinCount < 1) return;
  recordLiveGift(coinCount);

  const minGifts = parseInt(giftMinInput.value, 10) || 100;
  if (coinCount < minGifts) {
    addChatMessage("Système", `${username} a envoyé ${coinCount} pièces (minimum : ${minGifts}).`);
    return;
  }

  const userKey = username.toLocaleLowerCase('fr-FR');
  const boxChoice = selectedBoxByUser.get(userKey);
  if (boxChoice) {
    selectedBoxByUser.delete(userKey);
    processAction(username, coinCount, boxChoice, true);
    return;
  }

  const pendingGifts = pendingGiftsByUser.get(userKey) || [];
  pendingGifts.push(coinCount);
  pendingGiftsByUser.set(userKey, pendingGifts);
  addChatMessage(username, `${coinCount} pièces reçues. Choisis une boîte en commentant un numéro de 1 à 6.`);
}

// ==========================================
// 7. COMMANDES RACCOURCIS ET TESTS BOUTONS
// ==========================================
function triggerTestOpen(boxNum) {
  const randomUsers = ["Alex", "Sophie", "Lucas", "Léa", "Thomas"];
  const user = randomUsers[Math.floor(Math.random() * randomUsers.length)];
  processAction(user, 100, boxNum.toString());
}

function triggerSimulatedChat() {
  const user = document.getElementById('simUser').value || 'Spectateur';
  const gifts = parseInt(document.getElementById('simGifts').value) || 100;
  const cmd = document.getElementById('simCmd').value;

  processAction(user, gifts, cmd);
}

// ==========================================
// 8. IMPORT / EXPORT DE DONNÉES (JSON)
// ==========================================
function exportData() {
  const exportState = {
    ...gameState,
    backgroundImage: localStorage.getItem(BACKGROUND_STORAGE_KEY)
  };
  const saveFile = new Blob([JSON.stringify(exportState, null, 2)], { type: 'application/json' });
  const downloadUrl = URL.createObjectURL(saveFile);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.href = downloadUrl;
  downloadAnchor.download = `jeu-boites-live-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  document.getElementById('dataStatus').textContent = 'Données, statistiques et image exportées.';
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 3_000_000) {
    document.getElementById('dataStatus').textContent = 'Fichier trop volumineux (maximum 3 Mo).';
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const importedState = JSON.parse(e.target.result);
      if (!importedState || typeof importedState !== 'object' || Array.isArray(importedState)) {
        throw new Error('Format de sauvegarde invalide.');
      }

        if (importedState.backgroundImage &&
          !/^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/]+=*$/i.test(importedState.backgroundImage)) {
        throw new Error('Image de fond invalide dans la sauvegarde.');
      }

      gameState = normalizeGameState(importedState);
      if (Object.hasOwn(importedState, 'backgroundImage')) {
        if (importedState.backgroundImage) {
          localStorage.setItem(BACKGROUND_STORAGE_KEY, importedState.backgroundImage);
          setBackground('restore');
        } else {
          setBackground('clear');
        }
      }
      rtpSlider.value = gameState.rtpRate;
      rtpValueDisplay.innerText = `${gameState.rtpRate}%`;
      saveGameState();
      updateLeaderboard();
      updateLiveStats();
      document.getElementById('dataStatus').textContent = 'Sauvegarde importée : classement, statistiques et arrière-plan restaurés.';
      event.target.value = '';
    } catch (err) {
      document.getElementById('dataStatus').textContent = `Import impossible : ${err.message}`;
    }
  };
  reader.readAsText(file);
}

// ==========================================
// 9. PERSONNALISATION D'ARRIÈRE-PLAN
// ==========================================
function setBackground(type, event) {
  const upload = document.getElementById('backgroundUpload');
  const applyImage = imageData => {
    document.body.style.backgroundImage =
      `linear-gradient(rgba(8, 13, 25, .58), rgba(8, 13, 25, .72)), url("${imageData}")`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundAttachment = 'fixed';
  };

  if (type === 'restore') {
    try {
      const savedImage = localStorage.getItem(BACKGROUND_STORAGE_KEY);
      if (savedImage?.startsWith('data:image/')) applyImage(savedImage);
    } catch (error) {
      console.warn('Impossible de restaurer l’image de fond :', error);
    }
    return;
  }

  if (type === 'image') {
    const file = event?.target?.files?.[0];
    if (!file) return;
    if (!/^image\/(?:png|jpeg|webp|gif|svg\+xml)$/i.test(file.type) || file.size > 1_500_000) {
      addChatMessage('Système', 'Choisis une image valide de 1,5 Mo maximum pour pouvoir la conserver.');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const imageData = String(reader.result || '');
      applyImage(imageData);
      try {
        localStorage.setItem(BACKGROUND_STORAGE_KEY, imageData);
        addChatMessage('Système', 'Image appliquée et enregistrée dans ce navigateur.');
      } catch (error) {
        addChatMessage('Système', 'Image appliquée, mais impossible de la conserver dans le navigateur.');
      }
    };
    reader.readAsDataURL(file);
  } else if (type === 'clear') {
    document.body.style.backgroundImage = '';
    document.body.style.backgroundSize = '';
    document.body.style.backgroundPosition = '';
    document.body.style.backgroundAttachment = '';
    try {
      localStorage.removeItem(BACKGROUND_STORAGE_KEY);
    } catch (error) {
      console.warn('Impossible de supprimer l’image enregistrée :', error);
    }
    if (upload) upload.value = '';
    addChatMessage('Système', 'Arrière-plan par défaut restauré.');
  }
}

// Initialisation au chargement de la page
window.onload = function() {
  updateLeaderboard();
};