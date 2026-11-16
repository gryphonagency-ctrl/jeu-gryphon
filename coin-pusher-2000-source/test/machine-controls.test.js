import test from "node:test";
import assert from "node:assert/strict";
import Buttons from "../lib/components/input/buttons.js";
import ControlPanel from "../lib/components/input/control-panel.js";
import initialState from "../lib/data/initial-state.json" with { type: "json" };

test("l’état initial ne restaure plus le mécanisme supprimé ni les types de boutons cachés", () => {
    assert.equal(Object.hasOwn(initialState.cabinet, "coinRoller"), false);
    assert.ok(initialState.cabinet.buttons.every(colorButtons => colorButtons.length === 3));
});

test("les commandes utilisent les boutons réels et respectent leur disponibilité", async () => {
    const originals = Object.fromEntries(
        ["addButton", "enable", "blink", "on", "off", "onPress"].map(name => [name, Buttons[name]])
    );
    const instances = [];
    Buttons.addButton = () => {
        const instance = { enabled: true };
        instances.push(instance);
        return instance;
    };
    Buttons.enable = (instance, enabled) => { instance.enabled = enabled; };
    Buttons.blink = Buttons.on = Buttons.off = () => {};
    try {
        const actions = [];
        const panel = new ControlPanel({
            onPressStartButton: () => actions.push("start"),
            onPressDropButton: slot => actions.push(slot),
            onPressHoldButton: () => actions.push("hold")
        });
        await panel.initialize();
        assert.equal(panel.pressButton("start"), false);
        panel.enableStartButton();
        panel.enableDropButtons();
        panel.enableHoldButton();
        for (const name of ["start", "center", "hold"]) {
            assert.equal(panel.pressButton(name), true);
        }
        assert.deepEqual(actions, ["start", 1, "hold"]);
        panel.disableDropButtons();
        panel.disableHoldButton();
        for (const name of ["center", "hold"]) {
            assert.equal(panel.pressButton(name), false);
        }
        assert.equal(Object.hasOwn(panel.getButtonStates(), "a"), false);
        assert.equal(Object.hasOwn(panel.getButtonStates(), "b"), false);
        assert.equal(Object.hasOwn(panel.getButtonStates(), "shoot"), false);
        assert.equal(Object.hasOwn(panel.getButtonStates(), "left"), false);
        assert.equal(Object.hasOwn(panel.getButtonStates(), "right"), false);
        assert.throws(() => panel.pressButton("a"), RangeError);
        assert.throws(() => panel.pressButton("b"), RangeError);
        assert.throws(() => panel.pressButton("shoot"), RangeError);
        assert.throws(() => panel.pressButton("left"), RangeError);
        assert.throws(() => panel.pressButton("right"), RangeError);
        assert.throws(() => panel.pressButton("inconnu"), RangeError);
        assert.deepEqual(actions, ["start", 1, "hold"]);
    } finally {
        Object.assign(Buttons, originals);
    }
});

test("un bouton désactivé ne déclenche pas son action", () => {
    const previous = Buttons.onPress;
    let calls = 0;
    Buttons.onPress = () => { calls++; };
    try {
        assert.equal(Buttons.press({ enabled: false }), false);
        assert.equal(calls, 0);
        assert.equal(Buttons.press({ enabled: true }), true);
        assert.equal(calls, 1);
    } finally {
        Buttons.onPress = previous;
    }
});
