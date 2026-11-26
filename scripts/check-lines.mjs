#!/usr/bin/env node
// Enforces the CLAUDE.md rule: no hand-written source file over MAX_LINES lines.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MAX_LINES = 300;
const SOURCE = /\.(ts|tsx|py|rs|mjs)$/;
const EXCLUDED = [/\/components\/ui\//, /\/app\/generated\//, /\/drizzle\//, /^\.claude\//, /^\.agents\//];

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => SOURCE.test(f) && !EXCLUDED.some((re) => re.test(f)));

const tooLong = files
  .map((file) => ({ file, lines: readFileSync(file, "utf8").split("\n").length }))
  .filter(({ lines }) => lines > MAX_LINES);

for (const { file, lines } of tooLong) console.error(`${file}: ${lines} lines (max ${MAX_LINES}) — split it by responsibility`);
console.log(`check:lines — ${files.length} files checked, ${tooLong.length} over ${MAX_LINES}`);
process.exit(tooLong.length ? 1 : 0);
