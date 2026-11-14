export function setOverlayPosition(element, x, y) {
    if (![x, y].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 100)) {
        throw new RangeError("La position doit être comprise entre 0 % et 100 %.");
    }
    element.style.left = `${x}%`;
    element.style.top = `${y}%`;
    element.style.transform = `translate(-${x}%, -${y}%)`;
}

export function renderSpectatorLeaderboard(list, winners) {
    const document = list.ownerDocument;
    const rows = Array.from({ length: 3 }, (_, index) => {
        const winner = winners[index];
        const row = document.createElement("li");
        const avatar = document.createElement("div");
        avatar.className = "leaderboard-avatar";
        const placeholder = document.createElement("span");
        placeholder.textContent = "●";
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
        const rank = document.createElement("span");
        rank.className = "leaderboard-rank";
        rank.textContent = String(index + 1);
        avatar.append(rank);
        const name = document.createElement("span");
        name.className = "leaderboard-name";
        name.textContent = winner ? `@${winner.username}` : "—";
        const score = document.createElement("span");
        score.className = "leaderboard-score";
        score.textContent = winner ? `${winner.stars.toLocaleString("fr-FR")} ⭐` : "—";
        row.append(avatar, name, score);
        return row;
    });
    list.replaceChildren(...rows);
}
