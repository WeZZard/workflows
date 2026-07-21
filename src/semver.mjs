const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const BUMP_ORDER = Object.freeze({ patch: 0, minor: 1, major: 2 });

export function parseStableSemver(version) {
  const match = STABLE_SEMVER.exec(version);
  if (!match) {
    throw new Error(`Invalid stable SemVer version: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function bumpVersion(version, bump) {
  const parsed = parseStableSemver(version);
  if (!(bump in BUMP_ORDER)) {
    throw new Error(`Invalid SemVer bump: ${bump}`);
  }
  if (bump === "major") {
    return `${parsed.major + 1}.0.0`;
  }
  if (bump === "minor") {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

export function isStableVersionTag(tag) {
  return /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag);
}

export function stableVersionFromTag(tag) {
  if (!isStableVersionTag(tag)) {
    throw new Error(`Invalid stable SemVer tag: ${tag}`);
  }
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

export function highestBump(classifications) {
  if (classifications.length === 0) {
    throw new Error("Cannot aggregate an empty set of classifications");
  }
  return classifications.reduce((highest, item) =>
    BUMP_ORDER[item.bump] > BUMP_ORDER[highest] ? item.bump : highest,
  classifications[0].bump);
}
