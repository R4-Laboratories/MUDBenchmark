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
tag v0.1.0 ─▶ gate builds, proves, replays vectors ─▶ GitHub release
                                                          │
                     wick: mudbench-deploy.timer (10 min) ─┘
                          fetch ─▶ replay vectors ─▶ flip unit ─▶ restart
                                                        └─ health fails? roll back
```

**Tagged releases only.** An engine tick on `main` should not restart a world
people are standing in.

### The deployer

`mudbench-deploy` runs on wick and does, in order:

1. fetch the newest release (or a named tag)
2. download `MUDBench.holo` into `~/.mudbench/artifacts/<tag>/`
3. **replay every acceptance vector** — a release that does not replay never goes live
4. rewrite `WorkingDirectory` in the holo unit to the new artifact
5. restart the holo and the world
6. check `is-active` and `/health`; on failure, restore the previous directory and restart
7. keep the last three artifacts, so there is always a rollback target

```sh
mudbench-deploy --status      # what is deployed
mudbench-deploy               # deploy latest
mudbench-deploy v0.1.0        # deploy a tag
```

### A private repository needs a token

`~/.config/mudbench-github.token`, mode 600, with permission to read releases.
Without it the timer says `no release published yet` and exits quietly, which is
the correct behaviour for an empty release list.

`R4-Laboratories/MUDBenchmark` is currently **private**, so the token is
required. Making it public removes that step.
