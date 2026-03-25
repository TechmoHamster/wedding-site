import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dataDir = path.join(root, "data");
const backupRoot = path.join(root, "backups");

function timestamp() {
  const d = new Date();
  const parts = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
    String(d.getSeconds()).padStart(2, "0"),
  ];
  return `${parts[0]}-${parts[1]}-${parts[2]}_${parts[3]}-${parts[4]}-${parts[5]}`;
}

async function safeList(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function run() {
  await fs.mkdir(backupRoot, { recursive: true });
  const destDir = path.join(backupRoot, timestamp());
  await fs.mkdir(destDir, { recursive: true });

  const entries = await safeList(dataDir);
  const copied = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.(json|log)$/i.test(entry.name)) continue;

    const src = path.join(dataDir, entry.name);
    const dest = path.join(destDir, entry.name);
    await fs.copyFile(src, dest);
    copied.push(entry.name);
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    source: dataDir,
    files: copied,
  };

  await fs.writeFile(path.join(destDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Backup created: ${destDir}`);
  console.log(`Files copied: ${copied.length}`);
}

run().catch((error) => {
  console.error("Backup failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
