#!/usr/bin/env node
// Mechanizer: compile `.lex.tex` definitions into JavaScript.
//
// The end state this ratchet walks towards: every rule the runtime applies is
// the rule the model states, because the runtime calls generated code instead of
// re-deciding. This compiler handles the subset the model currently uses and
// fails loudly on anything else — a mechanizer that guesses is worse than none,
// because a wrong rule would look like a proved one.
//
// Supported: structures, definitions, `match` on Nat, `if`, `record`, `project`,
// calls, `=?`, `&&`, `Nat.succ`, numeric literals.
//
// Usage: node tools/mechanize.mjs [--check]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const MODULES = [{ name: "Pulses", title: "pulse schedule", file: "world/src/Pulses.lex.tex" }];

// --- tokenizer -----------------------------------------------------------

const TOKEN = /\(|\)|\{|\}|,|:=|=>|\||[A-Za-z_][A-Za-z0-9_.]*|\d+|=\?|&&/g;

function tokenize(text) {
  return text.match(TOKEN) ?? [];
}

class Parser {
  constructor(tokens) {
    this.t = tokens;
    this.i = 0;
  }
  peek() { return this.t[this.i]; }
  next() { return this.t[this.i++]; }
  expect(tok) {
    const got = this.next();
    if (got !== tok) throw new Error(`expected ${tok}, got ${got}`);
    return got;
  }

  // expression := andExpr
  expr() {
    let left = this.primary();
    while (this.peek() === "&&") {
      this.next();
      left = `(${left} && ${this.primary()})`;
    }
    return left;
  }

  primary() {
    if (this.peek() === "(") {
      this.next();
      if (this.peek() === "(") {
        // A parenthesised sub-expression, possibly followed by an infix operator.
        let inner = this.expr();
        if (this.peek() === "=?") {
          this.next();
          inner = `(${inner} === ${this.primary()})`;
        }
        this.expect(")");
        return inner;
      }
      const head = this.next();
      let out;
      if (head === "project") {
        const target = this.primary();
        const field = this.next();
        out = `(${target}).${field}`;
      } else if (head === "if") {
        const cond = this.expr();
        this.expect("then");
        const then = this.expr();
        this.expect("else");
        const otherwise = this.expr();
        out = `(${cond} ? ${then} : ${otherwise})`;
      } else if (head === "match") {
        out = this.matchExpr();
      } else if (head === "record") {
        const type = this.next();
        this.expect("{");
        const fields = [];
        while (this.peek() !== "}") {
          const name = this.next();
          this.expect(":=");
          fields.push(`${name}: ${this.expr()}`);
          if (this.peek() === ",") this.next();
        }
        this.expect("}");
        out = `make${type}({ ${fields.join(", ")} })`;
      } else {
        const args = [];
        while (this.peek() !== ")") args.push(this.expr());
        out = `${head}(${args.join(", ")})`;
      }
      // A parenthesised expression may be followed by an infix operator.
      if (this.peek() === "=?") {
        this.next();
        out = `(${out} === ${this.primary()})`;
      }
      this.expect(")");
      return out;
    }

    const tok = this.next();
    if (tok === "Nat.zero") return "0";
    if (tok === "Nat.succ") {
      // Nat.succ x  — a unary application written without parens in patterns
      const arg = this.primary();
      return `(${arg} + 1)`;
    }
    if (/^\d+$/.test(tok)) return tok;
    return tok;
  }

  // match <expr> | Nat.zero => <expr> | Nat.succ v => <expr>
  matchExpr() {
    const scrutinee = this.primary();
    const branches = [];
    while (this.peek() === "|") {
      this.next();
      if (this.peek() === "Nat.zero") {
        this.next();
        this.expect("=>");
        branches.push({ zero: true, body: this.expr() });
      } else if (this.peek() === "Nat.succ") {
        this.next();
        const binder = this.next();
        this.expect("=>");
        branches.push({ binder, body: this.expr() });
      } else {
        throw new Error(`unsupported match pattern ${this.peek()}`);
      }
    }
    if (branches.length !== 2) throw new Error("expected exactly zero and succ branches");
    const zero = branches.find((b) => b.zero);
    const succ = branches.find((b) => b.binder);
    // Nat is a non-negative integer, so two branches are a ternary.
    return `((${scrutinee}) === 0 ? ${zero.body} : ((__s) => { const ${succ.binder} = __s - 1; return ${succ.body}; })(${scrutinee}))`;
  }
}

// --- module compiler -----------------------------------------------------

function blocks(text, kind) {
  const out = [];
  const re = new RegExp(`${kind}\\{([\\s\\S]*?)\\n\\}`, "g");
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

function compile(text) {
  const structures = blocks(text, "structure").map((body) => {
    const name = body.match(/name:\s*([A-Za-z0-9_]+)/)[1];
    const fields = [...body.matchAll(/\{name:\s*([A-Za-z0-9_]+),\s*type:\s*[A-Za-z0-9_]+\}/g)].map((m) => m[1]);
    return { name, fields };
  });

  const definitions = blocks(text, "definition").map((body) => {
    const name = body.match(/name:\s*([A-Za-z0-9_]+)/)[1];
    const paramsText = body.match(/parameters:\s*\[(.*?)\]/s)[1];
    const params = [...paramsText.matchAll(/([A-Za-z0-9_]+)\s*:\s*[A-Za-z0-9_.]+/g)].map((m) => m[1]);
    const afterBody = body.split(/body:\s*/)[1];
    if (afterBody === undefined) throw new Error(`no body for ${name}`);
    const bodyText = afterBody.split(/\n\s*(?:axioms|recursive_argument):/)[0].replace(/,\s*$/, "").trim();
    const parsed = new Parser(tokenize(bodyText)).expr();
    return { name, params, js: parsed };
  });

  return { structures, definitions };
}

function emit(module, compiled) {
  const lines = [];
  lines.push(`// GENERATED from ${module.file} by tools/mechanize.mjs — do not edit by hand.`);
  lines.push(`// Source of truth: the model. Regenerate with: node tools/mechanize.mjs`);
  lines.push("");
  for (const s of compiled.structures) {
    lines.push(`export const make${s.name} = ({ ${s.fields.join(", ")} }) => ({ ${s.fields.join(", ")} });`);
  }
  lines.push("");
  for (const d of compiled.definitions) {
    lines.push(`export const ${d.name} = (${d.params.join(", ")}) => ${d.js};`);
  }
  lines.push("");
  return lines.join("\n");
}

// --- main ----------------------------------------------------------------

const checkOnly = process.argv.includes("--check");
let failed = false;

for (const module of MODULES) {
  const text = readFileSync(join(root, module.file), "utf8");
  const compiled = compile(text);
  const output = emit(module, compiled);
  const target = join(root, "runtime/generated", `${module.name}.mjs`);

  if (checkOnly) {
    const current = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (current !== output) {
      console.error(`drift: ${target} does not match the model — run node tools/mechanize.mjs`);
      failed = true;
    } else {
      console.log(`in sync: ${module.name} (${compiled.definitions.length} definitions, ${compiled.structures.length} structures)`);
    }
  } else {
    mkdirSync(join(root, "runtime/generated"), { recursive: true });
    writeFileSync(target, output);
    console.log(`wrote ${target} — ${compiled.definitions.length} definitions, ${compiled.structures.length} structures`);
  }
}

process.exit(failed ? 1 : 0);
