const MAX_IMPACTS_PER_SECOND = 24;
const MIN_IMPACT_INTERVAL_MS = 1000 / MAX_IMPACTS_PER_SECOND;
const DEFAULT_VOLUME = 0.45;

let audioContext;
let masterGain;
let volume = DEFAULT_VOLUME;
let lastImpactTime = Number.NEGATIVE_INFINITY;

function getAudioContext() {
    if (audioContext) {
        return audioContext;
    }
    const AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextConstructor) {
        console.error("Les sons des pièces ne sont pas pris en charge par ce navigateur.");
        return null;
    }
    audioContext = new AudioContextConstructor();
    masterGain = audioContext.createGain();
    masterGain.gain.value = volume;
    masterGain.connect(audioContext.destination);
    return audioContext;
}

export default class {
    static setVolume(value) {
        if (!Number.isFinite(value)) {
            throw new RangeError("Le volume doit être un nombre compris entre 0 et 1.");
        }
        volume = Math.max(0, Math.min(1, value));
        const context = getAudioContext();
        if (!context) {
            return volume;
        }
        masterGain.gain.setTargetAtTime(volume, context.currentTime, 0.02);
        if (context.state === "suspended") {
            void context.resume().catch(error => {
                console.warn("Impossible d’activer le son des pièces :", error);
            });
        }
        return volume;
    }

    static playImpact() {
        const context = getAudioContext();
        if (!context || volume === 0 || context.state !== "running") {
            return false;
        }
        const now = context.currentTime;
        const impactTime = performance.now();
        if (impactTime - lastImpactTime < MIN_IMPACT_INTERVAL_MS) {
            return false;
        }
        lastImpactTime = impactTime;

        const oscillator = context.createOscillator();
        const impactGain = context.createGain();
        const frequency = 520 + Math.random() * 620;
        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(frequency, now);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.55, now + 0.075);
        impactGain.gain.setValueAtTime(0.0001, now);
        impactGain.gain.exponentialRampToValueAtTime(0.22, now + 0.003);
        impactGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
        oscillator.connect(impactGain);
        impactGain.connect(masterGain);
        oscillator.start(now);
        oscillator.stop(now + 0.095);
        return true;
    }
}
