// Cesium の Workers・Assets などを public/cesium から辿れるようにする（npm install の後に自動で走る）
import { mkdirSync, symlinkSync, rmSync, cpSync } from "node:fs";
mkdirSync("public/cesium", { recursive: true });
for (const d of ["Workers", "ThirdParty", "Assets", "Widgets"]) {
  const dst = `public/cesium/${d}`, src = `../../node_modules/cesium/Build/Cesium/${d}`;
  rmSync(dst, { recursive: true, force: true });
  try { symlinkSync(src, dst, "dir"); } catch { cpSync(`node_modules/cesium/Build/Cesium/${d}`, dst, { recursive: true }); } // Windows はコピー
}
