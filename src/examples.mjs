import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function loadVersionBumpExamples(repositoryRoot) {
  const directory = join(repositoryRoot, ".agents/examples/version-bump");
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )
    .map((entry) => {
      const path = join(directory, entry.name);
      if (!statSync(path).isFile()) {
        throw new Error(`Version-bump example is not a regular file: ${path}`);
      }
      return { name: entry.name, content: readFileSync(path, "utf8") };
    });
}
