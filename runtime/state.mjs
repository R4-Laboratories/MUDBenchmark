// Durable world state: atomic writes, rotating backups, and a load that refuses
// to start on a corrupt file instead of silently starting an empty world.
//
// The game's identities and progress are the one thing a player cannot
// reconstruct. A parse error is therefore a stop, not a reset.

import {
  closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync,
  readFileSync, renameSync, writeSync,
} from "node:fs";
import { dirname } from "node:path";

const KEEP = 5;

export function loadStateFile(file, { initial, restore }) {
  if (!existsSync(file)) return initial();
  try {
    return restore(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    const backup = `${file}.1`;
    if (existsSync(backup)) {
      try {
        const restored = restore(JSON.parse(readFileSync(backup, "utf8")));
        const aside = `${file}.corrupt.${Date.now()}`;
        try { renameSync(file, aside); } catch {}
        console.error(`state: ${file} was unreadable (${error.message}); restored ${backup}; the bad file is at ${aside}`);
        return restored;
      } catch (backupError) {
        throw new Error(`${file} and ${backup} are unreadable; refusing to start (${error.message}; ${backupError.message})`);
      }
    }
    throw new Error(`${file} is unreadable (${error.message}); refusing to start so the file can be recovered`);
  }
}

export function saveStateFile(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  // Rotate first, so .1 is always the state before this write.
  for (let index = KEEP; index > 1; index -= 1) {
    const from = `${file}.${index - 1}`;
    const to = `${file}.${index}`;
    if (existsSync(from)) copyFileSync(from, to);
  }
  if (existsSync(file)) copyFileSync(file, `${file}.1`);

  const temporary = `${file}.tmp`;
  const fd = openSync(temporary, "w");
  try {
    writeSync(fd, `${JSON.stringify(state)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, file);
}
