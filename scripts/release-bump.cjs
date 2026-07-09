#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const arg = process.argv[process.argv.length - 1];
if (!arg) {
  console.error("Usage: pnpm run release:bump -- [major|minor|patch|X.Y.Z]");
  process.exit(1);
}

const pkgs = [
  "packages/plan-core",
  "packages/plan-mcp",
  "packages/plan-server",
  "packages/agent-plan",
];

const cur = JSON.parse(
  fs.readFileSync(path.join(pkgs[0], "package.json"), "utf-8")
).version;

let v;
if (/^\d/.test(arg)) {
  v = arg;
} else {
  const parts = cur.split(".").map(Number);
  switch (arg) {
    case "major":
      v = `${parts[0] + 1}.0.0`;
      break;
    case "minor":
      v = `${parts[0]}.${parts[1] + 1}.0`;
      break;
    case "patch":
      v = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
      break;
    default:
      console.error(`Unknown bump type: ${arg}. Use major|minor|patch|X.Y.Z`);
      process.exit(1);
  }
}

pkgs.forEach((p) => {
  const fp = path.join(p, "package.json");
  const j = JSON.parse(fs.readFileSync(fp, "utf-8"));
  const old = j.version;
  j.version = v;
  fs.writeFileSync(fp, JSON.stringify(j, null, 2) + "\n");
  console.log(`${p.split("/")[1]}: ${old} → ${v}`);
});

console.log("Bump done. Run pnpm install to relink.");
