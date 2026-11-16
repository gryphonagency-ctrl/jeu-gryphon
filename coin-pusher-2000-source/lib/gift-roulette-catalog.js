export const GIFT_ROULETTE_DEFINITIONS = [
    { id: "universe", name: "TikTok Universe", coinCount: 1000, initial: true },
    { id: "stars", name: "TikTok Stars", coinCount: 100, initial: true },
    { id: "lion", name: "Léon et le Lion", coinCount: 10, initial: true },
    { id: "zeus", name: "Zeus", coinCount: 3, initial: true },
    { id: "donut", name: "Donut", coinCount: 30 },
    { id: "gamepad", name: "Manette de jeu", coinCount: 100 },
    { id: "wednesday", name: "Mercredi gagnant", coinCount: 99 },
    { id: "hands-heart", name: "Cœur dans les mains", coinCount: 100 },
    { id: "wooden-staff", name: "Canne en bois", coinCount: 100 },
    { id: "bear", name: "Le petit Ourson", coinCount: 100 },
    { id: "confetti", name: "Confettis", coinCount: 100 },
    { id: "conch", name: "Énergie dans un coquillage", coinCount: 100 },
    { id: "earth-heart", name: "Cœur sur mon Terrien", coinCount: 100 },
    { id: "butterfly", name: "Papillon", coinCount: 88 },
    { id: "family", name: "Famille", coinCount: 90 },
    { id: "falcon", name: "Faucon", coinCount: 10999 },
    { id: "planet", name: "Planète merveilleuse", coinCount: 10000 },
    { id: "crystal-staff", name: "Canne de cristal", coinCount: 10000 },
    { id: "sunset-highway", name: "Autoroute au coucher du soleil", coinCount: 10000 },
    { id: "octopus", name: "Pieuvre", coinCount: 10000 },
    { id: "leon-lili", name: "Léon et Lili", coinCount: 9699 },
    { id: "safari", name: "Parc safari", coinCount: 8000 },
    { id: "drift", name: "Grand pilote de drift", coinCount: 7700 },
    { id: "tiktok", name: "TikTok", coinCount: 1, tier: "small" },
    { id: "ice-cream", name: "Cornet de crème glacée", coinCount: 1, tier: "small" },
    { id: "starfish", name: "Étoile de mer", coinCount: 1, tier: "small" },
    { id: "gg", name: "GG", coinCount: 1, tier: "small" },
    { id: "hand", name: "Main", coinCount: 1, tier: "small" },
    { id: "cafe", name: "Café", coinCount: 1, tier: "small" },
    { id: "flaming-heart", name: "Cœur en flammes", coinCount: 1, tier: "small" },
    { id: "cloud-heart", name: "Cœur nuage", coinCount: 1, tier: "small" }
];

export function createGiftRouletteCatalog(images) {
    return GIFT_ROULETTE_DEFINITIONS.map(gift => {
        const image = images[gift.id];
        if (!image) {
            throw new Error(`Image manquante pour le cadeau « ${gift.name} ».`);
        }
        return { ...gift, image };
    });
}
