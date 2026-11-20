import test from "node:test";
import assert from "node:assert/strict";
import CoinSounds from "../lib/components/coin-sounds.js";

test("le volume des pièces est borné et contrôle les impacts", () => {
    const oscillators = [];
    const disconnectedNodes = [];
    class FakeAudioContext {
        currentTime = 1;
        state = "running";
        destination = {};
        createGain() {
            return {
                gain: {
                    value: 0,
                    setTargetAtTime(value) { this.value = value; },
                    setValueAtTime() {},
                    exponentialRampToValueAtTime() {}
                },
                connect() {},
                disconnect() { disconnectedNodes.push("gain"); }
            };
        }
        createOscillator() {
            const oscillator = {
                frequency: {
                    setValueAtTime() {},
                    exponentialRampToValueAtTime() {}
                },
                connect() {},
                disconnect() { disconnectedNodes.push("oscillator"); },
                start() {},
                stop() {}
            };
            oscillators.push(oscillator);
            return oscillator;
        }
    }
    const previousAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = FakeAudioContext;
    try {
        assert.equal(CoinSounds.setVolume(1.5), 1);
        assert.equal(CoinSounds.playImpact(), true);
        assert.equal(oscillators.length, 1);
        assert.deepEqual(disconnectedNodes, []);
        oscillators[0].onended();
        assert.deepEqual(disconnectedNodes, ["oscillator", "gain"]);
        assert.equal(CoinSounds.setVolume(-0.2), 0);
        assert.equal(CoinSounds.playImpact(), false);
        assert.throws(() => CoinSounds.setVolume(Number.NaN), RangeError);
    } finally {
        globalThis.AudioContext = previousAudioContext;
    }
});
