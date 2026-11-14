import { decompressFrames, parseGIF } from "gifuct-js";

export function createGifAnimation(data, createCanvas = () => document.createElement("canvas")) {
    const gif = parseGIF(data);
    const frames = decompressFrames(gif, true).map(({ dims, delay, disposalType, patch }) => ({
        dims, delay: delay ?? 100, disposalType, patch
    }));
    if (!gif.lsd.width || !gif.lsd.height || !frames.length) {
        throw new Error("Le GIF ne contient aucune image utilisable.");
    }

    const canvas = createCanvas();
    canvas.width = gif.lsd.width;
    canvas.height = gif.lsd.height;
    const context = canvas.getContext("2d");
    const patchCanvas = createCanvas();
    const patchContext = patchCanvas.getContext("2d");
    if (!context || !patchContext) {
        throw new Error("Impossible de préparer l’animation du personnage.");
    }

    let frameIndex = 0;
    let lastTime;
    let elapsed = 0;
    let previousImage = null;
    const duration = frames.reduce((sum, frame) => sum + frame.delay, 0);

    function drawFrame(frame) {
        previousImage = frame.disposalType === 3
            ? context.getImageData(0, 0, canvas.width, canvas.height)
            : null;
        const { width, height, left, top } = frame.dims;
        if (patchCanvas.width !== width) patchCanvas.width = width;
        if (patchCanvas.height !== height) patchCanvas.height = height;
        const image = patchContext.createImageData(width, height);
        image.data.set(frame.patch);
        patchContext.putImageData(image, 0, 0);
        context.drawImage(patchCanvas, left, top);
    }

    function advance() {
        const current = frames[frameIndex];
        if (current.disposalType === 2) {
            const { left, top, width, height } = current.dims;
            context.clearRect(left, top, width, height);
        } else if (current.disposalType === 3 && previousImage) {
            context.putImageData(previousImage, 0, 0);
        }
        frameIndex = (frameIndex + 1) % frames.length;
        if (frameIndex === 0) context.clearRect(0, 0, canvas.width, canvas.height);
        drawFrame(frames[frameIndex]);
    }

    drawFrame(frames[0]);
    return {
        canvas,
        update(time) {
            if (lastTime === undefined || time < lastTime) {
                lastTime = time;
                return false;
            }
            elapsed += time - lastTime;
            lastTime = time;
            if (elapsed >= duration) elapsed %= duration;
            let changed = false;
            while (elapsed >= frames[frameIndex].delay) {
                elapsed -= frames[frameIndex].delay;
                advance();
                changed = true;
            }
            return changed;
        }
    };
}
