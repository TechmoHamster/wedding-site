import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, "data");
const TELEMETRY_FILE = path.join(DATA_DIR, "telemetry.log");
const ERROR_FILE = path.join(DATA_DIR, "errors.log");

type TelemetryRecord = {
  timestamp: string;
  event: string;
  payload: Record<string, unknown>;
  meta: {
    ip: string;
    userAgent: string;
  };
};

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function recordTelemetry(record: TelemetryRecord): Promise<void> {
  await ensureDataDir();
  const line = `${JSON.stringify(record)}\n`;
  await fs.appendFile(TELEMETRY_FILE, line, "utf8");

  if (record.event.includes("error") || record.event.includes("failed")) {
    await fs.appendFile(ERROR_FILE, line, "utf8");
  }
}
