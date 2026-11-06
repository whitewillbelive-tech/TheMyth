import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
mkdirSync(resolve("public"), { recursive: true });
for (const name of ["styles.css", "app.js"]) copyFileSync(resolve("web", name), resolve("public", name));
