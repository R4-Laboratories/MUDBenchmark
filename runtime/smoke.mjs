// Two clients against the running world, to prove one authority serves both
// and that room fan-out reaches only the room. Run: node smoke.mjs [port]

import net from "node:net";

const PORT = Number(process.argv[2] ?? 4000);
const lines = [];

function connect(label) {
  return new Promise((resolve) => {
    const socket = net.connect(PORT, "127.0.0.1", () => resolve(socket));
    socket.on("data", (chunk) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) lines.push(`${label} <- ${line}`);
      }
    });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const a = await connect("A");
const b = await connect("B");
await wait(300);

a.write("look\n");
await wait(250);
b.write("look\n");
await wait(250);

// A leaves the room; B must see the departure, A must not see itself arrive.
a.write("north\n");
await wait(400);
b.write("look\n");
await wait(250);

// A speaks in the corridor; B is in the atrium and must not hear it.
a.write("say hello corridor\n");
await wait(300);

a.write("quit\n");
b.write("quit\n");
await wait(400);

console.log(lines.join("\n"));
process.exit(0);
