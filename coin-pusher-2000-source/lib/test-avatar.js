export default function createTestAvatarDataUri() {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Impossible de créer l’avatar de démonstration.");

    context.fillStyle = "#7257c7";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#f4c7a1";
    context.beginPath();
    context.arc(64, 51, 25, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#33253b";
    context.beginPath();
    context.arc(64, 47, 25, Math.PI, Math.PI * 2);
    context.fill();
    context.fillStyle = "#ffca62";
    context.beginPath();
    context.arc(64, 143, 53, Math.PI, Math.PI * 2);
    context.fill();
    return canvas.toDataURL("image/png");
}
