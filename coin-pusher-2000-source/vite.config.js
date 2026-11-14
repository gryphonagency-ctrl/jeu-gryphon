import { defineConfig } from "vite";
import importMap from "@titovdima/vite-plugin-import-map";

export default defineConfig(() => {
    return {
        plugins: [importMap({
            imports: {
                "@dimforge/rapier3d-simd": "./rapier3d-f64/rapier3d-bundle.js"
            }
        }), {
            name: "coin-pusher-2000-deployment-paths",
            apply: "build",
            enforce: "post",
            transformIndexHtml(html) {
                const rapierImport = /"@dimforge\/rapier3d-simd"\s*:\s*"[^"]*rapier3d-bundle\.js"/;
                if (!rapierImport.test(html)) {
                    throw new Error("Impossible de trouver l’import map Rapier dans index.html.");
                }
                const portableHtml = html.replace(
                    rapierImport,
                    '"@dimforge/rapier3d-simd":"./rapier3d-f64/rapier3d-bundle.js"'
                );
                return portableHtml.replace(
                    "<head>",
                    '<head>\n    <base href="/coin-pusher-2000/">'
                );
            }
        }],
        base: "./",
        build: {
            outDir: "build",
            target: "esnext"
        },
        server: {
            port: 3000,
            open: true,
        }
    };
});