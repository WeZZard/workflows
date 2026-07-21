#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";

const workflowDirectory = ".github/workflows";
for (const name of readdirSync(workflowDirectory).filter((entry) => entry.endsWith(".yml")).sort()) {
  const path = join(workflowDirectory, name);
  const document = parseDocument(readFileSync(path, "utf8"));
  if (document.errors.length > 0) {
    throw new Error(`${path}: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  console.log(`OK ${path}`);
}
