    const { WebcastPushConnection } = require('tiktok-live-connector');
// Nom d'utilisateur du live (sans le @ ou avec)
const tiktokUsername = 'gryphon.agency';

// Créer la connexion
const tiktokLiveConnection = new WebcastPushConnection(tiktokUsername);

// Connexion au live
tiktokLiveConnection.connect().then(state => {
    console.info(`Connecté à la room id: ${state.roomId}`);
}).catch(err => { console.error ('Erreur de connexion:', err); });