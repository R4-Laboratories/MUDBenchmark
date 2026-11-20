#!/usr/bin/env python3
"""Build the release manifest that wick verifies before extraction.

The manifest binds the release tag and commit to the exact bytes of the holo
and the runtime archive. It is not a signature; the release is still trusted
through the GitHub release channel. It does catch a partial, swapped or
corrupted asset before a deploy.
"""

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return {"sha256": h.hexdigest(), "size": os.path.getsize(path)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--gate-run", required=True)
    parser.add_argument("--holo", required=True)
    parser.add_argument("--runtime", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    manifest = {
        "schema": "mudbenchmark/release/1",
        "tag": args.tag,
        "commit": args.commit,
        "gate_run": args.gate_run,
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "assets": {
            "MUDBench.holo": digest(args.holo),
            "runtime.tar.gz": digest(args.runtime),
        },
    }
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
        handle.write("\n")


if __name__ == "__main__":
    main()
