import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { parseStableSemver } from "./semver.mjs";

export const MANIFEST_CANDIDATES = Object.freeze([
  ".claude-plugin/plugin.json",
  "canonical/manifest.json",
]);

function requireRepositoryPath(repositoryRoot, path) {
  const absolutePath = resolve(repositoryRoot, path);
  const relativePath = relative(repositoryRoot, absolutePath);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Version file must be inside the repository: ${path}`);
  }
  return { absolutePath, relativePath };
}

function requireRegularFile(path) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`Version file does not exist or is not a regular file: ${path}`);
  }
}

export function detectManifest(repositoryRoot, explicitPath) {
  if (explicitPath) {
    const manifest = requireRepositoryPath(repositoryRoot, explicitPath);
    requireRegularFile(manifest.absolutePath);
    return manifest;
  }

  const matches = MANIFEST_CANDIDATES.map((path) => ({
    path,
    ...requireRepositoryPath(repositoryRoot, path),
  })).filter(({ absolutePath }) => existsSync(absolutePath) && statSync(absolutePath).isFile());

  if (matches.length === 0) {
    throw new Error(
      `Could not find a version file. Expected exactly one of: ${MANIFEST_CANDIDATES.join(", ")}`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Found multiple version files: ${matches.map(({ path }) => path).join(", ")}. Pass --version-file.`,
    );
  }
  return {
    absolutePath: matches[0].absolutePath,
    relativePath: matches[0].relativePath,
  };
}

export function readManifestVersion(path) {
  let document;
  try {
    document = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse version file ${path}: ${error.message}`);
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`Version file must contain a JSON object: ${path}`);
  }
  if (typeof document.version !== "string") {
    throw new Error(`Version file is missing a string version property: ${path}`);
  }
  parseStableSemver(document.version);
  return document.version;
}

export function writeManifestVersion(path, currentVersion, nextVersion) {
  const original = readFileSync(path, "utf8");
  const pattern = /("version"\s*:\s*)("(?:[^"\\]|\\.)*")/g;
  const matches = [];
  let match;
  while ((match = pattern.exec(original)) !== null) {
    let value;
    try {
      value = JSON.parse(match[2]);
    } catch {
      continue;
    }
    if (value === currentVersion) {
      matches.push({ index: match.index + match[1].length, length: match[2].length });
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      `Expected one textual version property with value ${currentVersion} in ${path}; found ${matches.length}`,
    );
  }

  const target = matches[0];
  const updated =
    original.slice(0, target.index) +
    JSON.stringify(nextVersion) +
    original.slice(target.index + target.length);
  writeFileSync(path, updated, "utf8");

  const verified = readManifestVersion(path);
  if (verified !== nextVersion) {
    throw new Error(`Version file update did not produce ${nextVersion}: ${path}`);
  }
}
