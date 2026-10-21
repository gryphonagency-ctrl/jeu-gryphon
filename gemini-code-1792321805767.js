// ==========================================
// 1. CONFIGURATION & ÉTAT GLOBAL DU JEU
// ==========================================
const RECOMPENSES = [10, 20, 50, 100, 0, 0];

let gameState = {
  rtpRate: 10, // Probabilité par défaut (10%)
  forceNextWin: false,
  players: {}, // Format: { "Pseudo": totalEtoiles }
  history: []
};

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
});

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
  window.speechSynthesis.cancel(); // Annule la voix en cours si nécessaire
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
  const btn = document.getElementById('btnVoiceToggle');
  btn.innerText = ttsEnabled ? "🔊 Voix Active" : "🔇 Voix Désactivée";
  btn.classList.toggle('active', ttsEnabled);
}

// ==========================================
// 3. LOGIQUE DU JEU & ROULEMENT DES BOÎTES
// ==========================================
function processAction(username, giftCount, boxChoice) {
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
  if (giftCount < minGifts) {
    addChatMessage("Système", `${username} a envoyé ${giftCount} pièces. (Minimum requis : ${minGifts})`);
    return;
  }

  addChatMessage(username, `a choisi la boîte ${boxIndex} avec un don de ${giftCount} pièces !`);

  // Calcul selon la probabilité RTP
  let isWin = false;
  if (gameState.forceNextWin) {
    isWin = true;
    gameState.forceNextWin = false;
  } else {
    const rand = Math.floor(Math.random() * 100) + 1;
    isWin = rand <= gameState.rtpRate;
  }

  triggerBoxAnimation(boxIndex, isWin, username);
}

function triggerBoxAnimation(boxIndex, isWin, username) {
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
        updateLeaderboard();

        // Affichage de la bannière overlay
        showWinnerBanner(username, reward);

        // Annonce Vocale
        speakText(`Félicitations à ${username} ! Il gagne ${reward} étoiles dans la boîte numéro ${boxIndex} !`);
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
function showWinnerBanner(name, amount) {
  winnerNameDisplay.innerText = name;
  winAmountDisplay.innerText = amount;
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
// 6. TIKTOK LIVE CONNECTOR SIMULATION / WS
// ==========================================
let tiktokConnected = false;

function connectTikTok() {
  const username = tiktokUsernameInput.value.trim();
  if (!username) {
    alert("Veuillez saisir un nom d'utilisateur TikTok.");
    return;
  }

  tiktokStatus.innerText = "Connexion au serveur TikTok en cours...";
  tiktokStatus.style.color = "yellow";

  // Simulation d'une connexion WebSocket
  setTimeout(() => {
    tiktokConnected = true;
    tiktokStatus.innerText = `● Connecté au Live de @${username}`;
    tiktokStatus.style.color = "#2ecc71";
    addChatMessage("Système", `Connecté avec succès au Live de @${username}`);
  }, 1500);
}

// ==========================================
// 7. COMMANDES RACCOURCIS ET TESTS BOUTONS
// ==========================================
function triggerTestOpen(boxNum) {
  const randomUsers = ["Alex", "Sophie", "Lucas", "Léa", "Thomas"];
  const user = randomUsers[Math.floor(Math.random() * randomUsers.length)];
  processAction(user, 100, boxNum.toString());
}

function setRtpMax() {
  gameState.rtpRate = 100;
  rtpSlider.value = 100;
  rtpValueDisplay.innerText = "100%";
  addChatMessage("Système", "Mode RTP Boost (100%) Activé !");
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
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(gameState, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `jeu_boites_live_save.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const importedState = JSON.parse(e.target.result);
      if (importedState.players) {
        gameState = importedState;
        rtpSlider.value = gameState.rtpRate || 10;
        rtpValueDisplay.innerText = rtpSlider.value + '%';
        updateLeaderboard();
        addChatMessage("Système", "Sauvegarde importée avec succès !");
      }
    } catch (err) {
      alert("Fichier JSON invalide.");
    }
  };
  reader.readAsText(file);
}

// ==========================================
// 9. PERSONNALISATION D'ARRIÈRE-PLAN
// ==========================================
function setBackground(type) {
  const url = document.getElementById('bgUrl').value;
  const board = document.getElementById('gameBoard');

  if (type === 'image') {
    board.style.backgroundImage = `url('${url}')`;
    board.style.backgroundSize = 'cover';
    board.style.backgroundPosition = 'center';
  } else if (type === 'clear') {
    board.style.backgroundImage = 'none';
  }
}

// Initialisation au chargement de la page
window.onload = function() {
  updateLeaderboard();
};