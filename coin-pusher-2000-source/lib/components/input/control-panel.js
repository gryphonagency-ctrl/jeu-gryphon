import { Vector3 } from "three";
import Buttons from "./buttons.js";

const BUTTONS_POSITION = [0, 0.16125, 1.25];
const BUTTONS_ROTATION = [2 * Math.PI + Math.PI / 10, 0, 0];
const START_BUTTON_POSITION = [.85, .2, .785];
const START_BUTTON_ROTATION = [Math.PI / 2, 0, 0];
const CENTER_DROP_BUTTON_POSITION_X = 0;
const CENTER_DROP_BUTTON_SLOT = 1;
const HOLD_BUTTON_POSITION_X = -.45;

export default class {

    #dropButtons = [];
    #startButton;
    #holdButton;
    #onPressDropButton;
    #onPressStartButton;
    #onPressHoldButton;

    constructor({ onPressDropButton, onPressStartButton, onPressHoldButton }) {
        this.#onPressDropButton = onPressDropButton;
        this.#onPressStartButton = onPressStartButton;
        this.#onPressHoldButton = onPressHoldButton;
    }

    async initialize() {
        this.#dropButtons[0] = Buttons.addButton({
            type: 0,
            color: 0,
            position: new Vector3(CENTER_DROP_BUTTON_POSITION_X, BUTTONS_POSITION[1], BUTTONS_POSITION[2]),
            rotation: new Vector3().fromArray(BUTTONS_ROTATION)
        });
        Buttons.enable(this.#dropButtons[0], false);
        this.#holdButton = Buttons.addButton({
            type: 2,
            color: 1,
            position: new Vector3(HOLD_BUTTON_POSITION_X, BUTTONS_POSITION[1], BUTTONS_POSITION[2]),
            rotation: new Vector3().fromArray(BUTTONS_ROTATION)
        });
        Buttons.enable(this.#holdButton, false);
        this.#startButton = Buttons.addButton({
            type: 1,
            color: 0,
            position: new Vector3(START_BUTTON_POSITION[0], START_BUTTON_POSITION[1], START_BUTTON_POSITION[2]),
            rotation: new Vector3().fromArray(START_BUTTON_ROTATION)
        });
        Buttons.enable(this.#startButton, false);
        Buttons.onPress = instance => {
            if (instance === this.#startButton) {
                this.#onPressStartButton();
            } else if (this.#dropButtons.includes(instance)) {
                this.#onPressDropButton(CENTER_DROP_BUTTON_SLOT);
            } else if (instance === this.#holdButton) {
                this.#onPressHoldButton();
            }
        };
    }

    getButtonStates() {
        return {
            start: this.#startButton.enabled,
            center: this.#dropButtons[0].enabled,
            hold: this.#holdButton.enabled
        };
    }

    pressButton(name) {
        const buttons = {
            start: this.#startButton,
            center: this.#dropButtons[0],
            hold: this.#holdButton
        };
        if (!Object.hasOwn(buttons, name)) {
            throw new RangeError("Bouton de la machine inconnu.");
        }
        if (!this.getButtonStates()[name]) {
            return false;
        }
        return Buttons.press(buttons[name]);
    }

    update() {
        // do nothing
    }

    refresh() {
        // do nothing
    }

    setDropButtonsOn() {
        for (const button of this.#dropButtons) {
            Buttons.on(button);
        }
    }

    enableStartButton() {
        Buttons.enable(this.#startButton, true);
        Buttons.blink(this.#startButton, true);
    }

    disableStartButton() {
        Buttons.enable(this.#startButton, false);
        Buttons.blink(this.#startButton, false);
    }

    enableDropButtons() {
        for (const button of this.#dropButtons) {
            Buttons.enable(button, true);
            Buttons.on(button);
        }
    }

    disableDropButtons() {
        for (const button of this.#dropButtons) {
            Buttons.enable(button, false);
            Buttons.off(button);
        }
    }

    enableHoldButton() {
        Buttons.enable(this.#holdButton, true);
        Buttons.on(this.#holdButton);
    }

    disableHoldButton() {
        Buttons.enable(this.#holdButton, false);
        Buttons.off(this.#holdButton);
    }

    get interactiveObjects() {
        return Buttons.interactiveObjects;
    }
}