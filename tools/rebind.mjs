#!/usr/bin/env node
// Operator console for an owner-authorized legacy rebind.
//
// The world listens on loopback telnet only; this tool speaks that protocol.
// Run it on the host that runs the world (wick), or through a local forward.
// The owner token is read from `~/.mudbench/owner.env` (the same file the
// systemd unit loads) unless --owner-token/--owner-token-file says otherwise.
//
//   node tools/rebind.mjs --list
//   node tools/rebind.mjs --name k1 --token --out k1.token
//   node tools/rebind.mjs --name k1 --prism sha256:<64 hex>
//
// A token is generated here, hashed here, and only the hash is sent. The
// plaintext is written once by this tool; the world stores only the hash.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function ownerToken() {
  const direct = option("owner-token", null);
  if (direct) return direct;
  if (process.env.MUDBENCH_OWNER_TOKEN) return process.env.MUDBENCH_OWNER_TOKEN;
  const file = option("owner-token-file", join(homedir(), ".mudbench", "owner.env"));
  if (!existsSync(file)) return "";
  const text = readFileSync(file, "utf8");
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith("MUDBENCH_OWNER_TOKEN="));
  if (line) return line.slice("MUDBENCH_OWNER_TOKEN=".length).trim();
  const bare = text.trim();
  return /^[0-9a-f]{64}$/.test(bare) ? bare : "";
}

// One command, one `#rebind {...}` answer. The server's banner and any room
// text are ignored; only the machine-readable line ends the read.
function ask(command, { host, port, timeoutMs = 6000 }) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let buffer = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("the world did not answer within 6 s")), timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${command}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const line = buffer.split(/\r?\n/).find((entry) => entry.startsWith("#rebind "));
      if (!line) return;
      try {
        finish(null, JSON.parse(line.slice("#rebind ".length)));
      } catch (error) {
        finish(new Error(`the world sent an unreadable answer: ${line.slice(0, 200)}`));
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("close", () => {
      if (!settled) finish(new Error(`the connection closed before an answer: ${buffer.slice(0, 200)}`));
    });
  });
}

function status(row) {
  if (row.retired || row.mergedInto) return `moved to ${row.mergedInto ?? "another account"}`;
  if (row.hasPassword) return "password";
  if (row.hasToken) return "token";
  return "no credential";
}

function printRows(payload, { all = false } = {}) {
  if (!payload.ok) throw new Error(payload.why ?? "the world refused the request");
  const rows = (payload.accounts ?? []).filter((row) => all || row.credentialless || row.hasToken || row.rebound);
  if (rows.length === 0) {
    console.log("No legacy account needs a rebind.");
    return;
  }
  for (const row of rows) {
    const levels = (row.levels ?? []).filter((level) => level !== null);
    const level = levels.length ? `lvl ${levels.join("/")}` : "lvl -";
    const rebounds = row.rebound ? `  rebound ${row.rebound.mode} at ${row.rebound.at}` : "";
    console.log(
      `${row.name.padEnd(24)} ${level.padEnd(8)} ${status(row).padEnd(14)} characters: ${(row.characters ?? []).join(", ") || "(none)"}${rebounds}`,
    );
  }
}

async function main() {
  const host = option("host", "127.0.0.1");
  const port = Number(option("port", process.env.TELNET_PORT ?? 4000));
  const owner = ownerToken();
  if (!owner) {
    throw new Error("no owner token: set MUDBENCH_OWNER_TOKEN, pass --owner-token-file, or write ~/.mudbench/owner.env");
  }
  const list = async () => {
    const payload = await ask(`rebind list ${owner}`, { host, port });
    return payload;
  };

  if (flag("list") || (!flag("token") && !option("prism", null))) {
    printRows(await list(), { all: flag("all") });
    return;
  }

  const name = option("name", null);
  if (!name) throw new Error("--name is required with --token or --prism");
  const prism = option("prism", null);
  if (flag("token") && prism) throw new Error("choose one mode: --token or --prism");

  let token = null;
  const command = flag("token")
    ? (() => {
      token = randomBytes(32).toString("base64url");
      return `rebind ${name} token ${sha256(token)} ${owner}`;
    })()
    : `rebind ${name} prism ${prism} ${owner}`;

  const answer = await ask(command, { host, port });
  if (!answer.ok) throw new Error(answer.why ?? "the world refused the rebind");

  // The reducer applies the intent on the next tick. Read the account back
  // rather than trusting the queue acknowledgement.
  await wait(900);
  const after = await list();
  const row = (after.accounts ?? []).find((entry) => entry.name === name);
  if (!row) throw new Error(`${name} disappeared from the account list`);
  if (flag("token")) {
    if (row.retired || !row.hasToken || row.rebound?.mode !== "token") {
      throw new Error(`${name} did not receive a token: ${status(row)}`);
    }
  } else {
    if (!row.retired || row.mergedInto !== prism) {
      throw new Error(`${name} did not move to ${prism}: ${status(row)}`);
    }
  }

  if (token) {
    const out = option("out", null);
    if (out) {
      writeFileSync(out, `${token}\n`, { mode: 0o600, flag: flag("force") ? "w" : "wx" });
      console.log(`rebound ${name} to a token; it is in ${out} (mode 600). Deliver it once.`);
    } else {
      console.error("rebound to a token; this is the only time it is printed.");
      console.log(token);
    }
  } else {
    console.log(`rebound ${name} to ${prism}; the legacy account is retired.`);
  }
}

main().catch((error) => {
  console.error(`rebind: ${error.message}`);
  process.exit(1);
});
