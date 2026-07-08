// Extract the release notes body for a single version from CHANGELOG.md, for
// use as the GitHub Release description. Usage:
//   node extract-changelog-section.js <x.y.z>
const fs = require("node:fs");

const version = process.argv[2];
if (!version) {
  console.error("Usage: node extract-changelog-section.js <x.y.z>");
  process.exit(1);
}

const content = fs.readFileSync("CHANGELOG.md", "utf8");
const lines = content.split(/\r?\n/);
const heading = `## [${version}]`;
const startIdx = lines.findIndex((line) => line.startsWith(heading));

if (startIdx === -1) {
  console.error(`No CHANGELOG.md section found for ${heading}`);
  process.exit(1);
}

let endIdx = lines.findIndex(
  (line, i) => i > startIdx && (line.startsWith("## [") || /^\[.+\]:\s/.test(line)),
);
if (endIdx === -1) endIdx = lines.length;

console.log(lines.slice(startIdx + 1, endIdx).join("\n").trim());
