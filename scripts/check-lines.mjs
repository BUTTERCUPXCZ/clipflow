#!/usr/bin/env node
// Enforces the CLAUDE.md rule: no hand-written source file over MAX_LINES lines.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const MAX_LINES = 300;
const SOURCE = /\.(ts|tsx|py|rs|mjs)$/;
const EXCLUDED = [/\/components\/ui\//, /\/app\/generated\//, /\/drizzle\//, /^\.claude\//, /^\.agents\//];

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  // existsSync: git still lists files deleted in the working tree until the deletion is staged.
  .filter((f) => SOURCE.test(f) && !EXCLUDED.some((re) => re.test(f)) && existsSync(f));

const countLines = (text) => text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

const tooLong = files
  .map((file) => ({ file, lines: countLines(readFileSync(file, "utf8")) }))
  .filter(({ lines }) => lines > MAX_LINES);

for (const { file, lines } of tooLong) console.error(`${file}: ${lines} lines (max ${MAX_LINES}) — split it by responsibility`);
console.log(`check:lines — ${files.length} files checked, ${tooLong.length} over ${MAX_LINES}`);
process.exit(tooLong.length ? 1 : 0);
