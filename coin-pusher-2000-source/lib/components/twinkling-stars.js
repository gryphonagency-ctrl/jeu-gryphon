import {
    AdditiveBlending,
    BufferGeometry,
    Float32BufferAttribute,
    Points,
    ShaderMaterial
} from "three";

const STAR_COUNT = 192;
const STAR_Z = -0.317;
const STAR_Y_MIN = 0.68;
const STAR_Y_MAX = 1.58;
const STAR_X_MIN = -1.35;
const STAR_X_MAX = 1.35;
const STAR_COLORS = [
    [1, 0.83, 0.98],
    [0.78, 0.9, 1],
    [1, 0.96, 0.78]
];

export default function createTwinklingStars(scene) {
    const positions = [];
    const sizes = [];
    const phases = [];
    const speeds = [];
    const colors = [];

    for (let index = 0; index < STAR_COUNT; index++) {
        const x = seededRandom(index, 1);
        const y = seededRandom(index, 2);
        const color = STAR_COLORS[Math.floor(seededRandom(index, 3) * STAR_COLORS.length)];
        positions.push(
            STAR_X_MIN + x * (STAR_X_MAX - STAR_X_MIN),
            STAR_Y_MIN + y * (STAR_Y_MAX - STAR_Y_MIN),
            STAR_Z
        );
        sizes.push(0.012 + seededRandom(index, 4) * 0.02);
        phases.push(seededRandom(index, 5) * Math.PI * 2);
        speeds.push(0.8 + seededRandom(index, 6) * 2.4);
        colors.push(...color);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new Float32BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new Float32BufferAttribute(phases, 1));
    geometry.setAttribute("aSpeed", new Float32BufferAttribute(speeds, 1));
    geometry.setAttribute("aColor", new Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();

    const material = new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
        uniforms: { uTime: { value: 0 } },
        vertexShader: `
            attribute float aSize;
            attribute float aPhase;
            attribute float aSpeed;
            attribute vec3 aColor;
            uniform float uTime;
            varying float vOpacity;
            varying vec3 vColor;
            void main() {
                vec3 positionWithDrift = position;
                positionWithDrift.x += sin(uTime * 0.12 + aPhase) * 0.006;
                positionWithDrift.y += cos(uTime * 0.1 + aPhase) * 0.004;
                float twinkle = 0.5 + 0.5 * sin(uTime * aSpeed + aPhase);
                vOpacity = 0.04 + 0.96 * twinkle * twinkle;
                vColor = aColor;
                vec4 viewPosition = modelViewMatrix * vec4(positionWithDrift, 1.0);
                gl_PointSize = aSize * (300.0 / max(1.0, -viewPosition.z));
                gl_Position = projectionMatrix * viewPosition;
            }
        `,
        fragmentShader: `
            varying float vOpacity;
            varying vec3 vColor;
            void main() {
                float radius = length(gl_PointCoord - vec2(0.5));
                float glow = 1.0 - smoothstep(0.08, 0.5, radius);
                if (glow <= 0.01) discard;
                gl_FragColor = vec4(vColor, glow * vOpacity);
            }
        `
    });
    const stars = new Points(geometry, material);
    stars.frustumCulled = false;
    scene.addObject(stars);

    return {
        update(deltaSeconds) {
            material.uniforms.uTime.value += deltaSeconds;
        }
    };
}

function seededRandom(index, salt) {
    const value = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453;
    return value - Math.floor(value);
}
