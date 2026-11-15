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
world/.prism/build/9911e65f81a018d2ad63f2c166550c73ddcc78f1a2fecf64bed7362ff4ac95ac
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
