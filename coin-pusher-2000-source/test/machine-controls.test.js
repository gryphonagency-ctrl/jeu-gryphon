import test from "node:test";
import assert from "node:assert/strict";
import Buttons from "../lib/components/input/buttons.js";
import ControlPanel from "../lib/components/input/control-panel.js";

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
            onPressShootButton: () => actions.push("shoot"),
            onPressHoldButton: () => actions.push("hold")
        });
        await panel.initialize();
        assert.equal(panel.pressButton("start"), false);
        panel.enableStartButton();
        panel.enableDropButtons();
        panel.enableHoldButton();
        panel.enableShootButton();
        for (const name of ["start", "left", "center", "right", "hold", "shoot"]) {
            assert.equal(panel.pressButton(name), true);
        }
        assert.deepEqual(actions, ["start", 0, 1, 2, "hold", "shoot"]);
        panel.disableDropButtons();
        panel.disableHoldButton();
        panel.disableShootButton();
        for (const name of ["left", "center", "right", "hold", "shoot"]) {
            assert.equal(panel.pressButton(name), false);
        }
        instances[5].enabled = true;
        instances[6].enabled = true;
        assert.equal(panel.getButtonStates().a, false);
        assert.equal(panel.getButtonStates().b, false);
        assert.equal(panel.pressButton("a"), false);
        assert.equal(panel.pressButton("b"), false);
        assert.throws(() => panel.pressButton("inconnu"), RangeError);
        assert.deepEqual(actions, ["start", 0, 1, 2, "hold", "shoot"]);
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
