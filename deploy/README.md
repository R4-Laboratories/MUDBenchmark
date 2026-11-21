# Deployment on wick

The world runs as two systemd **user** services, so it survives an SSH session
ending and starts on boot. Nothing here opens an inbound port.

## Install

```sh
mkdir -p ~/.config/systemd/user
cp deploy/mudbench-holo.service deploy/mudbench-world.service ~/.config/systemd/user/
sudo loginctl enable-linger "$USER"     # without this, user services stop at logout
systemctl --user daemon-reload
systemctl --user enable --now mudbench-holo.service mudbench-world.service
```

## Check

```sh
systemctl --user is-active mudbench-world.service mudbench-holo.service
curl -s http://127.0.0.1:8090/health
journalctl --user -u mudbench-world.service -n 50
```

`Restart=always` with `RestartSec=3` means a crash inside the world is a three
second outage, and the state on disk is restored by the checkpoint.

## The holo path is pinned

`mudbench-holo.service` names one build directory:

```
world/.prism/build/60586c76706a0862de2a2678552b20929c70e59090b4d07ddc88962788d9eac4
```

A new `prismpm build` produces a new digest and the unit keeps serving the old
one until that path is updated. That is deliberate — an upgrade should be a
reviewable edit, not a side effect of running a build.

## Loopback only

The world binds `127.0.0.1` on 4000, 8090 and 8082. Nothing needs a public
interface: the tunnel reaches it from localhost. The ufw rules for those ports
have been removed, so a scan of the host finds nothing of ours.

## Public access needs a Cloudflare tunnel

No inbound port is used. `cloudflared` dials out; Cloudflare terminates TLS and
the origin stays unreachable from the internet. See `cloudflared.service` for the
template once a tunnel token exists.

## Publishing and deploying

A static app's deploy is its update: the artifact is the running thing. Ours is
a server, so "update" means the artifact reaching wick, and wick is behind NAT —
CI cannot reach it. So the flow is **pull**, not push.

```
merged PR ─▶ Gate on main ─▶ publish.yml (merged PR only) ─▶ tagged GitHub release
                                                               │
                          wick: mudbench-deploy.timer (10 min) ─┘
                          manifest verify ─▶ replay vectors ─▶ flip unit ─▶ restart
                                                               └─ health fails? roll back
```

`publish.yml` runs when a **merged PR** has a green Gate on the merge commit.
It reuses that Gate's holo artifact, packages the runtime, writes a
`release-manifest.json`, increments the patch tag and publishes. Direct pushes
and the six-hour pacing loop are skipped; a maintainer can still use the manual
**Release** workflow for those.

Pause automatic publishing with the repository variable `AUTO_RELEASE=off`.
No GitHub runner, SSH key or inbound port is added to wick.

### The deployer

`mudbench-deploy` runs on wick and does, in order:

1. fetch the newest release (or a named tag)
2. download `release-manifest.json`, `MUDBench.holo` and `runtime.tar.gz`
3. verify the manifest tag, asset SHA-256 and sizes — a mismatched asset never reaches extraction
4. **replay every acceptance vector** — a release that does not replay never goes live
5. rewrite `WorkingDirectory` in the holo unit to the new artifact
6. restart the holo and the world
7. check `is-active` and `/health`; on failure, restore the previous directory and restart
8. keep the last three artifacts, so there is always a rollback target

Releases published before the manifest existed can be deployed only with
`MUDBENCH_ALLOW_UNMANIFESTED=1` for a deliberate rollback. Normal deploys
refuse them.

```sh
mudbench-deploy --status      # what is deployed
mudbench-deploy               # deploy latest
mudbench-deploy v0.1.0        # deploy a tag
```

### Install or update the deployer

The deployer is installed on wick, not fetched by the world service:

```sh
scp deploy/mudbench-deploy.sh wick:~/.local/bin/mudbench-deploy
ssh wick 'chmod 700 ~/.local/bin/mudbench-deploy'
ssh wick '~/.local/bin/mudbench-deploy --status'
```

Update it once when the verification rules change. The timer keeps running the
installed copy.

### A private repository needs a token

`~/.config/mudbench-github.token`, mode 600, with permission to read releases.
Without it the timer says `no release published yet` and exits quietly, which is
the correct behaviour for an empty release list.

`R4-Laboratories/MUDBenchmark` is currently **private**, so the token is
required. Making it public removes that step.
