/**
 * Compile src/ into what npm ships: dist/esm (import) and dist/cjs (require), each with its own type
 * declarations, so the package loads the same from an ES module, from CommonJS and under Jest.
 * No bundler: two runs of the TypeScript compiler.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

rmSync(join(root, "dist"), { recursive: true, force: true });
for (const config of ["tsconfig.esm.json", "tsconfig.cjs.json"]) {
  execFileSync(process.execPath, [tsc, "-p", join(root, config)], { cwd: root, stdio: "inherit" });
}
// The compiler rewrites "./x.ts" to "./x.js" in the JavaScript it emits but not in the declarations,
// and a declaration that names a .ts file resolves to nothing once installed.
const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
for (const file of walk(join(root, "dist")).filter((f) => f.endsWith(".d.ts"))) {
  const text = readFileSync(file, "utf8");
  writeFileSync(file, text.replace(/(from\s+["']|import\(["'])(\.{1,2}\/[^"']+)\.ts(["'])/g, "$1$2.js$3"));
}
// The command (package.json "bin"): npm marks it executable on install; this does the same for a local run.
chmodSync(join(root, "dist", "esm", "mcp", "cli.js"), 0o755);
// The package is "type": "module"; this marks the CommonJS half as what it is.
writeFileSync(join(root, "dist", "cjs", "package.json"), '{ "type": "commonjs" }\n');
console.log("built dist/esm and dist/cjs");
