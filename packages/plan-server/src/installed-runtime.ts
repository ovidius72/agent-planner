import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { compatibleServiceProtocols, packageVersionFromModule, serviceRuntimeDir } from "@agent-plan/core";

const packageName = "@agent-plan/server";
const installedPackagePath = ["node_modules", "@agent-plan", "server"];
const semanticVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function compareRuntimeVersions(left: string, right: string): number {
  const a = semanticVersion.exec(left);
  const b = semanticVersion.exec(right);
  if (!a || !b) throw new TypeError("Invalid registered runtime version.");
  for (const field of [1, 2, 3]) {
    const delta = BigInt(a[field]!) - BigInt(b[field]!);
    if (delta !== 0n) return delta > 0n ? 1 : -1;
  }
  if (!a[4] || !b[4]) return Number(!a[4]) - Number(!b[4]);
  const leftParts = a[4].split(".");
  const rightParts = b[4].split(".");
  for (const [index, part] of leftParts.entries()) {
    const other = rightParts[index];
    if (other === undefined) return 1;
    if (part === other) continue;
    const numeric = /^\d+$/.test(part);
    const otherNumeric = /^\d+$/.test(other);
    if (numeric && otherNumeric) return BigInt(part) > BigInt(other) ? 1 : -1;
    if (numeric !== otherNumeric) return numeric ? -1 : 1;
    return part > other ? 1 : -1;
  }
  return leftParts.length - rightParts.length;
}

interface RuntimeCandidate {
  version: string;
  entry: string;
  executable: string;
}

async function installedCandidate(root: string, version: string): Promise<RuntimeCandidate | undefined> {
  const directory = join(root, version);
  try {
    // The distribution installer publishes a real, private version directory.
    const info = await lstat(directory);
    if (!info.isDirectory() || (info.mode & 0o022) || (process.getuid && info.uid !== process.getuid())) return undefined;
    const manifest = join(directory, ...installedPackagePath, "package.json");
    if (!(await realpath(manifest)).startsWith(directory + sep)) return undefined;
    const pkg = JSON.parse(await readFile(manifest, "utf8")) as { name?: unknown; version?: unknown; plannerServiceProtocol?: unknown };
    const clientProtocols = compatibleServiceProtocols();
    if (pkg.name !== packageName || pkg.version !== version || typeof pkg.plannerServiceProtocol !== "string"
      || !compatibleServiceProtocols(pkg.plannerServiceProtocol).some((protocol) => clientProtocols.includes(protocol))) return undefined;
    const entry = await realpath(join(dirname(manifest), "dist", "registered-runtime.js"));
    if (!entry.startsWith(directory + sep)) return undefined;
    await access(entry, constants.R_OK);
    const bundledNode = join(directory, "bin", "node");
    const executable = await realpath(bundledNode).catch(() => undefined);
    if (executable) {
      if (!executable.startsWith(directory + sep)) return undefined;
      await access(executable, constants.X_OK);
    }
    return { version, entry, executable: executable ?? process.execPath };
  } catch {
    return undefined;
  }
}

export async function selectRegisteredRuntime(home: string): Promise<RuntimeCandidate> {
  const own = packageVersionFromModule(import.meta.url, packageName);
  const fallback = { version: own.version, entry: fileURLToPath(new URL("./registered-runtime.js", import.meta.url)), executable: process.execPath };
  const root = await realpath(serviceRuntimeDir(home)).catch(() => serviceRuntimeDir(home));
  const versions = (await readdir(root).catch(() => [])).filter((entry) => semanticVersion.test(entry));
  versions.sort((a, b) => compareRuntimeVersions(b, a));
  for (const version of versions) {
    if (compareRuntimeVersions(version, fallback.version) < 0) break;
    const runtime = await installedCandidate(root, version);
    if (runtime) return runtime;
  }
  return fallback;
}

async function copyInstalledPackage(manifest: string, destination: string, parents = new Set<string>()): Promise<void> {
  const identity = await realpath(manifest);
  if (parents.has(identity)) return;
  const dependencies = new Set([...parents, identity]);
  await cp(dirname(identity), destination, {
    recursive: true, dereference: true, errorOnExist: true, force: false,
    filter: (file) => basename(file) !== "node_modules",
  });
  const pkg = JSON.parse(await readFile(identity, "utf8")) as { dependencies?: Record<string, string> };
  const resolveFromPackage = createRequire(identity).resolve;
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    const entry = resolveFromPackage(name);
    const dependency = packageVersionFromModule(entry, name);
    if (!dependency.packageJsonPath) throw new Error(`Cannot locate the installed runtime dependency ${name}.`);
    await copyInstalledPackage(dependency.packageJsonPath, join(destination, "node_modules", name), dependencies);
  }
}

/** Publish a private, version-pinned copy from a real npm installation. */
export async function stageInstalledRegisteredRuntime(home: string): Promise<void> {
  const own = packageVersionFromModule(import.meta.url, packageName);
  if (!own.packageJsonPath?.includes(`${sep}node_modules${sep}`)) return;
  if (!semanticVersion.test(own.version)) throw new TypeError("Invalid installed planner service version.");
  const root = serviceRuntimeDir(home);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const localRoot = await realpath(root);
  const versionDir = join(localRoot, own.version);
  if (await lstat(versionDir).catch(() => undefined)) return;
  const staging = await mkdtemp(join(localRoot, ".stage-"));
  try {
    await copyInstalledPackage(own.packageJsonPath, join(staging, ...installedPackagePath));
    await rename(staging, versionDir);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
