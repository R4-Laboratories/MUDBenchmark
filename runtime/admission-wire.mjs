// Encode the seven-byte transition record the hologram guest parses.
//
// The HTTP intent endpoint turns the JSON string into UTF-8 bytes. A room id
// above 127 would become two bytes and the guest would answer "invalid
// request", so the wire form maps every numeric field into 0..127. The move
// rule only compares room and origin for equality, both taken from the same
// room, so the mapping preserves the decision; transfer and speak ignore the
// room fields. Identity and clearance use only small credential/flag values.

const safe = (value) => (Number.isInteger(value) && value >= 0 ? value & 0x7f : 0);

export function admissionWire({ kind = 0, room = 0, origin = 0, destination = 0, held = 0, amount = 0, free = 0, extra = [] } = {}) {
  if (kind === 1) return String.fromCharCode(kind, safe(room), safe(origin), safe(destination), 0, 0, 0);
  if (kind === 0 || kind === 2 || kind === 3 || kind === 4) {
    return String.fromCharCode(kind, 0, 0, 0, safe(held), safe(amount), safe(free));
  }
  return String.fromCharCode(kind, safe(room), safe(origin), safe(destination), safe(held), safe(amount), safe(free), ...extra.map(safe));
}
