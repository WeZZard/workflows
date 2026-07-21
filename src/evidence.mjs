export const DIFF_CHUNK_BYTES = 96 * 1024;

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function splitAtLinePrefix(value, prefix) {
  const parts = [];
  let start = 0;
  let searchFrom = 0;

  while (searchFrom < value.length) {
    const found = value.indexOf(`\n${prefix}`, searchFrom);
    if (found === -1) {
      break;
    }
    const boundary = found + 1;
    parts.push(value.slice(start, boundary));
    start = boundary;
    searchFrom = boundary + prefix.length;
  }
  parts.push(value.slice(start));
  return parts.filter((part) => part.length > 0);
}

function splitLinesLosslessly(value) {
  const lines = [];
  let start = 0;
  while (start < value.length) {
    const newline = value.indexOf("\n", start);
    if (newline === -1) {
      lines.push(value.slice(start));
      break;
    }
    lines.push(value.slice(start, newline + 1));
    start = newline + 1;
  }
  return lines;
}

function splitOversizedString(value, maxBytes) {
  const parts = [];
  let current = "";
  let currentBytes = 0;

  for (const codePoint of value) {
    const codePointBytes = byteLength(codePoint);
    if (current && currentBytes + codePointBytes > maxBytes) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += codePoint;
    currentBytes += codePointBytes;
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

function refineFilePart(filePart, maxBytes) {
  if (byteLength(filePart) <= maxBytes) {
    return [filePart];
  }

  const hunkParts = splitAtLinePrefix(filePart, "@@ ");
  const fragments = [];
  for (const hunkPart of hunkParts) {
    if (byteLength(hunkPart) <= maxBytes) {
      fragments.push(hunkPart);
      continue;
    }
    for (const line of splitLinesLosslessly(hunkPart)) {
      if (byteLength(line) <= maxBytes) {
        fragments.push(line);
      } else {
        fragments.push(...splitOversizedString(line, maxBytes));
      }
    }
  }
  return fragments;
}

export function chunkDiff(diff, maxBytes = DIFF_CHUNK_BYTES) {
  if (!Number.isInteger(maxBytes) || maxBytes < 4) {
    throw new Error("Diff chunk size must be an integer of at least 4 bytes");
  }
  if (diff.length === 0) {
    return [];
  }

  const fragments = splitAtLinePrefix(diff, "diff --git ").flatMap((filePart) =>
    refineFilePart(filePart, maxBytes),
  );
  const chunks = [];
  let current = "";

  for (const fragment of fragments) {
    if (current && byteLength(current) + byteLength(fragment) > maxBytes) {
      chunks.push(current);
      current = "";
    }
    current += fragment;
  }
  if (current) {
    chunks.push(current);
  }

  if (chunks.join("") !== diff) {
    throw new Error("Internal error: diff chunking changed the diff contents");
  }
  if (chunks.some((chunk) => byteLength(chunk) > maxBytes)) {
    throw new Error("Internal error: a diff chunk exceeds the byte limit");
  }
  return chunks;
}

export function buildClassificationPrompt({
  currentVersion,
  baseTag,
  commitLog,
  changedPaths,
  examples,
  chunk,
  chunkIndex,
  chunkCount,
}) {
  const exampleText = examples.length
    ? examples
        .map(({ name, content }) => `### ${name}\n${content.trimEnd()}`)
        .join("\n\n")
    : "(none)";

  return [
    "/skill:version-bump Classify this release evidence.",
    "",
    `Current version: ${currentVersion}`,
    `Latest stable tag: ${baseTag ?? "(none; initial release history)"}`,
    `Diff chunk: ${chunkIndex + 1} of ${chunkCount}`,
    "",
    "## Commits since the latest stable tag",
    commitLog || "(none)",
    "",
    "## Changed paths",
    changedPaths || "(none)",
    "",
    "## Repository classification examples",
    exampleText,
    "",
    "## Complete contents of this diff chunk",
    "```diff",
    chunk,
    "```",
    "",
    "Return only the JSON object required by the skill.",
  ].join("\n");
}
