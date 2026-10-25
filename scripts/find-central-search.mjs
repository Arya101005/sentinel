import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
const root = process.cwd();
const wantedExports = ["useFdrs","useFdr","useInstitutions","useProfiles","useNotifications","useDiscrepancies","useApplications","useAuditEvents","useDashboardSummary","useSettings","useUnreadNotifications","useLogEvent"];
const queries = readFileSync(resolve(root, "src/lib/queries.ts"), "utf8");
console.log("=== Defined query exports in src/lib/queries.ts ===");
for (const n of wantedExports) {
  console.log(` - ${n}: ${new RegExp("export function " + n + "\\b").test(queries) ? "defined" : "absent"}`);
}
console.log("\n=== Files importing from @/lib/queries ===");
const srcDir = resolve(root, "src");
function walkDir(dir, depth = 0) {
  const rows = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      rows.push(...walkDir(full, depth + 1));
    } else if (/\.tsx?$/.test(entry.name)) {
      rows.push(full);
    }
  }
  return rows;
}
const files = walkDir(srcDir);
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const match = text.match(/from\s+['"]@\/lib\/queries['"]/);
  if (!match) continue;
  const lines = text.split("\n");
  const importLine = lines.findIndex(l => /from\s+['"]@\/lib\/queries['"]/.test(l));
  if (importLine < 0) continue;
  const namedMatch = lines[importLine].match(/import\s*\{([^}]*)\}\s*from\s+['"]@\/lib\/queries['"]/);
  const imports = namedMatch ? namedMatch[1].split(",").map(s => s.trim()).filter(Boolean) : ["<unnamed>"];
  console.log(`\n${file.replace(root + "/", "")}`);
  console.log(" imports:", imports.join(", "));
}
