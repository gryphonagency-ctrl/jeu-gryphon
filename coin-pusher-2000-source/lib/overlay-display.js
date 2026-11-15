export function setOverlayPosition(element, x, y, scalePercent = 100) {
    if (![x, y].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 100)) {
        throw new RangeError("La position doit être comprise entre 0 % et 100 %.");
    }
    if (!Number.isSafeInteger(scalePercent) || scalePercent < 30 || scalePercent > 100) {
        throw new RangeError("La taille doit être comprise entre 30 % et 100 %.");
    }
    element.style.left = `${x}%`;
    element.style.top = `${y}%`;
    element.style.transformOrigin = `${x}% ${y}%`;
    const scale = scalePercent === 100 ? "" : ` scale(${scalePercent / 100})`;
    element.style.transform = `translate(-${x}%, -${y}%)${scale}`;
}

export function renderSpectatorLeaderboard(list, winners) {
    const document = list.ownerDocument;
    const podiumPlaces = ["1er", "2e", "3e"];
    const rows = podiumPlaces.map((place, index) => {
        const winner = winners[index];
        const row = document.createElement("li");
        if (!winner) {
            row.className = "leaderboard-placeholder";
        }
        const avatar = document.createElement("div");
        avatar.className = "leaderboard-avatar";
        const placeholder = document.createElement("span");
        placeholder.textContent = winner ? "●" : "—";
        placeholder.setAttribute("aria-hidden", "true");
        avatar.append(placeholder);
        if (winner?.avatarUrl) {
            const image = document.createElement("img");
            image.alt = `Photo de profil de @${winner.username}`;
            image.addEventListener("load", () => { placeholder.hidden = true; });
            image.addEventListener("error", () => {
                image.hidden = true;
                placeholder.hidden = false;
            });
            image.src = winner.avatarUrl;
            avatar.append(image);
        }
        const name = document.createElement("span");
        name.className = "leaderboard-name";
        name.textContent = winner ? `@${winner.username}` : "En attente";
        const score = document.createElement("span");
        score.className = "leaderboard-score";
        score.textContent = winner ? `${winner.stars.toLocaleString("fr-FR")} ⭐` : "";
        const step = document.createElement("span");
        step.className = "leaderboard-podium-step";
        step.textContent = place;
        step.setAttribute("aria-hidden", "true");
        row.append(avatar, name, score, step);
        return row;
    });
    list.replaceChildren(...rows);
}
