import DigitsPanel from "./digits-panel.js";

const DIGITS_COUNT_SCORE = 8;
const COLOR_SCORE = 0;
const POSITION_SCORE = [-0.35, 1.115, -0.33];
const ROTATION_SCORE = [0, 0, 0];
const DIGITS_COUNT_COINS = 4;
const COLOR_COINS = 0;
const POSITION_COINS = [0.79, 1.115, -0.33];
const ROTATION_COINS = [0, 0, 0];
const DIGITS_COUNT_POINTS = 6;
const COLOR_POINTS = 0;
const POSITION_POINTS = [0.15, 1.115, -0.33];
const ROTATION_POINTS = [0, 0, 0];

export default class {

    constructor({ scene, state }) {
        this.#scene = scene;
        this.#state = state;
    }

    #scene;
    #state;
    #score;
    #points;
    #coins;

    async initialize() {
        this.#score = new DigitsPanel({
            scene: this.#scene,
            position: POSITION_SCORE,
            rotation: ROTATION_SCORE,
            digitsCount: DIGITS_COUNT_SCORE,
            color: COLOR_SCORE
        });
        await this.#score.initialize();
        this.#points = new DigitsPanel({
            scene: this.#scene,
            position: POSITION_POINTS,
            rotation: ROTATION_POINTS,
            digitsCount: DIGITS_COUNT_POINTS,
            color: COLOR_POINTS
        });
        await this.#points.initialize();
        this.#coins = new DigitsPanel({
            scene: this.#scene,
            position: POSITION_COINS,
            rotation: ROTATION_COINS,
            digitsCount: DIGITS_COUNT_COINS,
            color: COLOR_COINS
        });
        await this.#coins.initialize();
    }

    update() {
        this.#score.set(this.#state.score);
        this.#points.set(this.#state.points);
        this.#coins.set(this.#state.coins);
    }

    refresh() {
        this.#score.refresh();
        this.#coins.refresh();
        this.#points.refresh();
    }

}