// Adresse de ton serveur Node.js sur Render
const RENDER_SERVER_URL = "https://ton-application-render.onrender.com";

// Récupération du pseudo passé dans l'URL (ex: https://monjeu.itch.io/jeu?streamer=pseudo_ami)
const urlParams = new URLSearchParams(window.location.search);
const streamerUsername = urlParams.get('streamer');

// Connexion au WebSocket sur Render
const socket = io(RENDER_SERVER_URL, {
    query: { username: streamerUsername }
});

// Écoute des événements TikTok venant de ton serveur Render
socket.on('tiktok-gift', (data) => {
    console.log(`Cadeau reçu sur le live de ${streamerUsername}:`, data);
    // Code pour casser le coffre, faire sauter le ballon, etc.
});