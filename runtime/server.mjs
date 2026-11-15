// MUDBench world server — one authority, two transports.
//
// The verified holo decides admission; this process owns the world. Nothing
// here re-implements a rule that the model states. The split:
//
//   server  : topology (which exits exist), who is where, who sees what
//   holo    : whether a claimed transition is admissible
//
// A command carries witnesses the holo can check. The holo does not know the
// exit table; it checks that the actor claims to be standing where the exit
// starts. The server is what refuses an exit that does not exist.

import net from "node:net";
import http from "node:http";
import { WebSocketServer } from "ws";
import { recordSpan, digest } from "./telemetry.mjs";

const HOLO_URL = process.env.HOLO_URL ?? "http://127.0.0.1:8082";
const TELNET_PORT = Number(process.env.TELNET_PORT ?? 4000);
const WS_PORT = Number(process.env.WS_PORT ?? 4001);

// --- world ---------------------------------------------------------------

const ROOMS = {
  1: { name: "Atrium", exits: { north: 2, east: 3 } },
  2: { name: "Corridor", exits: { south: 1 } },
  3: { name: "Storeroom", exits: { west: 1 } },
};

const actors = new Map(); // id -> { id, name, room, send }
let nextId = 1;

const roomActors = (room) =>
  [...actors.values()].filter((a) => a.room === room);

const othersIn = (room, self) =>
  roomActors(room).filter((a) => a !== self);

function broadcast(room, text, except) {
  for (const a of roomActors(room)) if (a !== except) a.send(text);
}

function describe(room, self) {
  const r = ROOMS[room];
  const others = othersIn(room, self).map((a) => a.name);
  const exits = Object.keys(r.exits).join(", ") || "none";
  return [
    ``,
    `[${r.name}]`,
    others.length ? `You are not alone: ${others.join(", ")}.` : `You are alone.`,
    `Exits: ${exits}.`,
    ``,
  ].join("\r\n");
}

// --- the verified decision ----------------------------------------------

// kind: 0 wait, 1 move, 3 engage, 4 speak. Byte layout matches the model.
async function admit({ kind, room, origin = 0, destination = 0 }) {
  const payload = String.fromCharCode(kind, room, origin, destination, 0, 0, 0);
  const res = await fetch(`${HOLO_URL}/_hologram/intent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: 1, name: "application.invoke", payload }),
  });
  if (!res.ok) throw new Error(`holo ${res.status}`);
  const body = await res.json();
  return body.outputs?.[0] ?? "invalid request";
}

// --- command handling ----------------------------------------------------

const DIRECTIONS = { n: "north", s: "south", e: "east", w: "west",
  north: "north", south: "south", east: "east", west: "west" };

async function handle(actor, line) {
  const text = line.trim();
  if (!text) return;
  const [verb, ...rest] = text.toLowerCase().split(/\s+/);

  if (verb === "quit") {
    actor.send("Goodbye.\r\n");
    broadcast(actor.room, `${actor.name} leaves.`, actor);
    actors.delete(actor.id);
    actor.close?.();
    return;
  }

  if (verb === "look" || verb === "l") {
    actor.send(describe(actor.room, actor));
    return;
  }

  if (verb === "who") {
    actor.send(`Present: ${roomActors(actor.room).map((a) => a.name).join(", ")}\r\n`);
    return;
  }

  if (verb === "say") {
    const started = Date.now();
    const verdict = await admit({ kind: 4, room: actor.room });
    recordSpan("world.transition", {
      "actor.id": actor.id,
      "action.kind": "speak",
      "room.from": actor.room,
      "admission.verdict": verdict,
      "observation.hash": digest(`${actor.room}:say`),
      "event.count": verdict === "admissible" ? othersIn(actor.room, actor).length : 0,
    }, Date.now() - started);
    if (verdict !== "admissible") return actor.send("You cannot speak here.\r\n");
    broadcast(actor.room, `${actor.name} says: ${rest.join(" ")}`, actor);
    actor.send(`You say: ${rest.join(" ")}\r\n`);
    return;
  }

  const dir = DIRECTIONS[verb];
  if (dir) {
    const exits = ROOMS[actor.room].exits;
    const target = exits[dir];
    if (!target) return actor.send(`You cannot go ${dir}.\r\n`);

    // The server owns topology; the holo checks the witness.
    const started = Date.now();
    const verdict = await admit({
      kind: 1,
      room: actor.room,
      origin: actor.room,
      destination: target,
    });
    recordSpan("world.transition", {
      "actor.id": actor.id,
      "action.kind": "move",
      "room.from": actor.room,
      "room.to": target,
      "admission.verdict": verdict,
      "observation.hash": digest(`${actor.room}:${dir}`),
      "event.count": verdict === "admissible" ? othersIn(actor.room, actor).length + 1 : 0,
    }, Date.now() - started);
    if (verdict !== "admissible") return actor.send("That move is refused.\r\n");

    const from = actor.room;
    broadcast(from, `${actor.name} leaves ${dir}.`, actor);
    actor.room = target;
    actor.send(describe(target, actor));
    broadcast(target, `${actor.name} arrives.`, actor);
    return;
  }

  actor.send(`I do not know "${verb}". Try look, who, say, n/s/e/w, quit.\r\n`);
}

// --- connection handling -------------------------------------------------

function attach(actor, { send, close }) {
  actor.send = send;
  actor.close = close;
  actors.set(actor.id, actor);
  send(`Welcome to MUDBench, ${actor.name}.\r\n`);
  send(describe(actor.room, actor));
  broadcast(actor.room, `${actor.name} arrives.`, actor);
}

const server = net.createServer((socket) => {
  const id = nextId++;
  const actor = { id, name: `guest-${id}`, room: 1 };
  let buffer = "";
  attach(actor, {
    send: (t) => { if (socket.writable) socket.write(t); },
    close: () => socket.end(),
  });
  socket.on("error", () => {}); // a dead client must never take the world down
  socket.on("data", async (chunk) => {
    buffer += chunk.toString("utf8");
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      try { await handle(actor, line); } catch (e) { socket.write(`error: ${e.message}\r\n`); }
    }
  });
  socket.on("close", () => {
    broadcast(actor.room, `${actor.name} vanishes.`, actor);
    actors.delete(actor.id);
  });
});

const wss = new WebSocketServer({ port: WS_PORT });
wss.on("connection", (ws) => {
  const id = nextId++;
  const actor = { id, name: `agent-${id}`, room: 1 };
  attach(actor, {
    send: (t) => { if (ws.readyState === 1) ws.send(t.replace(/\r\n/g, "\n")); },
    close: () => ws.close(),
  });
  ws.on("error", () => {});
  ws.on("message", async (data) => {
    for (const line of data.toString("utf8").split("\n")) {
      try { await handle(actor, line); } catch (e) { ws.send(`error: ${e.message}\n`); }
    }
  });
  ws.on("close", () => {
    broadcast(actor.room, `${actor.name} vanishes.`, actor);
    actors.delete(actor.id);
  });
});

server.listen(TELNET_PORT, () => {
  console.log(`telnet on :${TELNET_PORT}`);
  console.log(`websocket on :${WS_PORT}`);
  console.log(`holo at ${HOLO_URL}`);
});
