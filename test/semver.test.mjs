import test from "node:test";
import assert from "node:assert/strict";
import {
  bumpVersion,
  highestBump,
  isStableVersionTag,
  parseStableSemver,
  stableVersionFromTag,
} from "../src/semver.mjs";

test("parses stable SemVer and calculates every bump", () => {
  assert.deepEqual(parseStableSemver("1.2.3"), { major: 1, minor: 2, patch: 3 });
  assert.equal(bumpVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(bumpVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(bumpVersion("1.2.3", "major"), "2.0.0");
});

test("rejects prereleases, leading zeroes, and unknown bumps", () => {
  assert.throws(() => parseStableSemver("1.2.3-beta.1"), /Invalid stable SemVer/);
  assert.throws(() => parseStableSemver("01.2.3"), /Invalid stable SemVer/);
  assert.throws(() => bumpVersion("1.2.3", "fix"), /Invalid SemVer bump/);
});

test("recognizes stable tags and chooses the highest classification", () => {
  assert.equal(isStableVersionTag("v1.2.3"), true);
  assert.equal(isStableVersionTag("1.2.3"), true);
  assert.equal(isStableVersionTag("v1.2.3-rc.1"), false);
  assert.equal(stableVersionFromTag("v1.2.3"), "1.2.3");
  assert.equal(stableVersionFromTag("1.2.3"), "1.2.3");
  assert.throws(() => stableVersionFromTag("v1.2.3-rc.1"), /Invalid stable SemVer tag/);
  assert.equal(
    highestBump([{ bump: "patch" }, { bump: "major" }, { bump: "minor" }]),
    "major",
  );
  assert.throws(() => highestBump([]), /empty set/);
});
