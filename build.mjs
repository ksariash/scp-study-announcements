import { execFileSync } from "node:child_process";
import { CHABURAS, CURRENT_ZMAN } from "./src/chaburas.js";

if (CURRENT_ZMAN !== "2026-summer") throw new Error("Unexpected current Zman.");
if (!Array.isArray(CHABURAS) || CHABURAS.length < 200) throw new Error("Chabura directory appears incomplete.");
const keys = CHABURAS.map(item => item.region + "\u0000" + item.name);
if (new Set(keys).size !== keys.length) throw new Error("Duplicate chabura directory entries.");

for (const file of ["src/index.js","src/chaburas.js","public/app.js"]) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
console.log("Validated SCP Study Announcements source and " + CHABURAS.length + " chabura entries.");
