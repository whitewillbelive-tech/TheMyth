import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
mkdirSync(resolve("public"), { recursive: true });
for (const name of [
  "styles.css", "app.js", "atlas-city-map.js", "atlas-data.js", "atlas-galaxy.js",
  "atlas-geometry.js", "atlas-navigation.js", "atlas-passage-view.js", "atlas-passages.js",
  "atlas-renderer.js", "atlas-view.js",
]) copyFileSync(resolve("web", name), resolve("public", name));
