import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { parseStableSemver } from "./semver.mjs";

export const MANIFEST_CANDIDATES = Object.freeze([
  ".claude-plugin/plugin.json",
  "canonical/manifest.json",
]);

export const COMPANION_VERSION_CANDIDATES = Object.freeze([
  { path: ".codex-plugin/plugin.json", kind: "json" },
  { path: "package.json", kind: "optional-json" },
  { path: "package-lock.json", kind: "optional-package-lock" },
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

function readJsonObject(path, label = "Version file") {
  let document;
  try {
    document = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse version file ${path}: ${error.message}`);
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`${label} must contain a JSON object: ${path}`);
  }
  return document;
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
  const document = readJsonObject(path);
  if (typeof document.version !== "string") {
    throw new Error(`Version file is missing a string version property: ${path}`);
  }
  parseStableSemver(document.version);
  return document.version;
}

function optionalManifestVersion(path) {
  const document = readJsonObject(path);
  if (document.version === undefined) {
    return null;
  }
  if (typeof document.version !== "string") {
    throw new Error(`Version file has a non-string version property: ${path}`);
  }
  parseStableSemver(document.version);
  return document.version;
}

function readPackageLockVersion(path, { optional = false } = {}) {
  const document = readJsonObject(path, "Package lock");
  const rootVersion = document.version;
  const packageVersion = document.packages?.[""]?.version;
  if (optional && rootVersion === undefined && packageVersion === undefined) {
    return null;
  }
  if (typeof rootVersion !== "string" || typeof packageVersion !== "string") {
    throw new Error(
      `Package lock must contain string versions at version and packages[""].version: ${path}`,
    );
  }
  parseStableSemver(rootVersion);
  parseStableSemver(packageVersion);
  if (rootVersion !== packageVersion) {
    throw new Error(
      `Package lock versions disagree in ${path}: version=${rootVersion}, packages[""].version=${packageVersion}`,
    );
  }
  return rootVersion;
}

function updatedManifestContents(path, currentVersion, nextVersion) {
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
  return (
    original.slice(0, target.index) +
    JSON.stringify(nextVersion) +
    original.slice(target.index + target.length)
  );
}

function updatedPackageLockContents(path, currentVersion, nextVersion) {
  const document = readJsonObject(path, "Package lock");
  const lockVersion = readPackageLockVersion(path);
  if (lockVersion !== currentVersion) {
    throw new Error(
      `Package lock version ${lockVersion} does not match primary version ${currentVersion}: ${path}`,
    );
  }
  document.version = nextVersion;
  document.packages[""].version = nextVersion;
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function writeManifestVersion(path, currentVersion, nextVersion) {
  writeFileSync(path, updatedManifestContents(path, currentVersion, nextVersion), "utf8");
  const verified = readManifestVersion(path);
  if (verified !== nextVersion) {
    throw new Error(`Version file update did not produce ${nextVersion}: ${path}`);
  }
}

export function detectVersionSet(repositoryRoot, explicitPath) {
  const primary = detectManifest(repositoryRoot, explicitPath);
  const current = readManifestVersion(primary.absolutePath);
  const files = [{ ...primary, kind: "json" }];
  if (explicitPath) {
    return { primary, current, files };
  }

  const mismatches = [];
  for (const candidate of COMPANION_VERSION_CANDIDATES) {
    const companion = requireRepositoryPath(repositoryRoot, candidate.path);
    if (!existsSync(companion.absolutePath)) {
      continue;
    }
    requireRegularFile(companion.absolutePath);

    let version;
    if (candidate.kind === "optional-json") {
      version = optionalManifestVersion(companion.absolutePath);
    } else if (candidate.kind === "optional-package-lock") {
      version = readPackageLockVersion(companion.absolutePath, { optional: true });
    } else {
      version = readManifestVersion(companion.absolutePath);
    }
    if (version === null) {
      continue;
    }
    if (version !== current) {
      mismatches.push(`${companion.relativePath}=${version}`);
      continue;
    }
    files.push({
      absolutePath: companion.absolutePath,
      relativePath: companion.relativePath,
      kind: candidate.kind === "optional-package-lock" ? "package-lock" : "json",
    });
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Version files must match primary version ${current}: ${mismatches.join(", ")}`,
    );
  }
  return { primary, current, files };
}

export function writeVersionSet(versionSet, currentVersion, nextVersion) {
  const updates = versionSet.files.map((file) => ({
    ...file,
    contents:
      file.kind === "package-lock"
        ? updatedPackageLockContents(file.absolutePath, currentVersion, nextVersion)
        : updatedManifestContents(file.absolutePath, currentVersion, nextVersion),
  }));

  for (const update of updates) {
    writeFileSync(update.absolutePath, update.contents, "utf8");
  }

  for (const file of versionSet.files) {
    const verified =
      file.kind === "package-lock"
        ? readPackageLockVersion(file.absolutePath)
        : readManifestVersion(file.absolutePath);
    if (verified !== nextVersion) {
      throw new Error(`Version file update did not produce ${nextVersion}: ${file.absolutePath}`);
    }
  }
}
