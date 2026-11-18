// Retention planning for telemetry files.
//
// The live spans and trace are never candidates. Archived files are kept by
// age and by a total-byte cap; the oldest archives go first. The CLI defaults
// to a dry run, so a retention policy can be inspected before anything is
// deleted.

const LIVE = new Set(["spans.jsonl", "trace.jsonl"]);

export function planRetention(files, { now = Date.now(), keepDays = 90, maxBytes = 4 * 1024 * 1024 * 1024 } = {}) {
  const entries = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const keep = [];
  const remove = [];
  let total = 0;
  const cutoff = now - keepDays * 24 * 60 * 60 * 1000;
  for (const file of entries) {
    const name = file.path.split("/").pop();
    if (LIVE.has(name)) {
      keep.push(file);
      total += file.size;
      continue;
    }
    if (file.mtimeMs < cutoff) {
      remove.push(file);
      continue;
    }
    keep.push(file);
    total += file.size;
  }
  // The cap applies to the kept set. Drop the oldest kept archive until it
  // fits, never the live file.
  for (let index = keep.length - 1; index >= 0 && total > maxBytes; index -= 1) {
    const file = keep[index];
    if (LIVE.has(file.path.split("/").pop())) continue;
    remove.push(file);
    keep.splice(index, 1);
    total -= file.size;
  }
  return {
    schema: "mudbenchmark/retention/1",
    now,
    keepDays,
    maxBytes,
    keep,
    remove,
    bytes: total,
    removedBytes: remove.reduce((sum, file) => sum + file.size, 0),
  };
}
