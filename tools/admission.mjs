// The admission policy in JavaScript, paired with world/src/Admission.lex.tex.
//
// The publisher asks this before it writes the generated pacing file; the gate
// replays the kernel's fixtures through this file and checks the same requests
// and responses in the model. A candidate is admitted only when all five
// obligations hold: its identity binds the inventory, report and world; it is
// no worse on every measured component; it is better on at least one; every
// change is inside its bound; and the gate passed.

export const ADMISSION_KIND = 8;

export function admissionAdmits({ identity, fidelity, benefit, bounds, checks }) {
  return Boolean(identity && fidelity && benefit && bounds && checks);
}

export function admissionRequest(flags) {
  return [
    ADMISSION_KIND,
    flags.identity ? 1 : 0,
    flags.fidelity ? 1 : 0,
    flags.benefit ? 1 : 0,
    flags.bounds ? 1 : 0,
    flags.checks ? 1 : 0,
    0,
  ];
}

export function decodeAdmissionRequest(bytes) {
  if (!bytes || bytes.length !== 7 || bytes[0] !== ADMISSION_KIND) return null;
  return {
    identity: bytes[1] === 1,
    fidelity: bytes[2] === 1,
    benefit: bytes[3] === 1,
    bounds: bytes[4] === 1,
    checks: bytes[5] === 1,
  };
}

export function admissionVerdict(bytes) {
  const flags = decodeAdmissionRequest(bytes);
  if (!flags) return "invalid request";
  return admissionAdmits(flags) ? "admissible" : "refused";
}
