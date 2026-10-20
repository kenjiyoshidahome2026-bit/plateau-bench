import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readFileSync, readdirSync, copyFileSync, existsSync, mkdirSync } from "node:fs";

const ver = (p) => JSON.parse(readFileSync(`node_modules/${p}/package.json`, "utf8")).version;

// Navara のワーカー（@navaramap/three/dist/assets/index-*.js）は、Draco の wasm と自前の wasm を
// new URL("draco_decoder-*.wasm", self.location.href) で「自分と同じ場所」から読む。import.meta.url ではないので
// vite の build はこの 2 つを dist/assets に写さず、頁は wasm の代わりに index.html（404 の代用）を受け取って
// b3dm の解読に全部失敗する（console: expected magic word 00 61 73 6d, found 3c 21 64 6f）。build 後に写して埋める。
const copyNavaraWasm = () => ({
  name: "copy-navara-wasm",
  apply: "build",
  closeBundle() {
    const from = resolve(__dirname, "node_modules/@navaramap/three/dist/assets");
    const to = resolve(__dirname, "dist/assets");
    mkdirSync(to, { recursive: true });
    for (const f of readdirSync(from).filter((f) => f.endsWith(".wasm"))) {
      if (!existsSync(resolve(to, f))) copyFileSync(resolve(from, f), resolve(to, f));
    }
  },
});

export default defineConfig({
  plugins: [copyNavaraWasm()],
  define: {
    __ORTHO_VERSION__: JSON.stringify(ver("@ortho-earth/globe")),
    __NAVARA_VERSION__: JSON.stringify(ver("@navaramap/three")),
  },
  // ワーカーを new URL(..., import.meta.url) で呼ぶ物は事前バンドルしない
  optimizeDeps: { exclude: ["@ortho-earth/globe", "@navaramap/three", "@navaramap/three-default-plugin"] },
  build: {
    target: "es2022",
    rollupOptions: {
      input: Object.fromEntries(["index", "maplibre", "cesium", "ortho-earth", "navara"].map((n) => [n, resolve(__dirname, `${n}.html`)])),
    },
  },
  worker: { format: "es" },
});
