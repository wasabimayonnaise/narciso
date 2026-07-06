# NARCISO

**Connect quietly.**

---

## What is this

Narciso is a decentralized peer-to-peer chat application with text, voice, and video. There are no accounts, no servers handling your messages, and no data retention of any kind. When you close the app, everything disappears.

Peer discovery and WebRTC signaling happen through BitTorrent trackers — infrastructure that was never designed for chat and therefore keeps none of your metadata. Once two peers find each other, the trackers are out of the picture entirely. Everything after that is a direct encrypted connection between you and whoever you're talking to.

It runs as a desktop app via Electron. There is no web version, no mobile app, no cloud sync. It is deliberately and permanently offline-first.

---

## Features

- **Random stranger matching** — one click drops you into a lobby and finds you a stranger. Hit Next to move on, no explanation required.
- **Ephemeral group rooms** — join any named room. Anyone with the name can join. Nothing persists when everyone leaves.
- **Text, voice, and video** — all WebRTC, all direct, all encrypted in transit.
- **Consent toggles** — global MIC/CAM/EAR/EYE controls so you're never accidentally broadcasting.
- **Per-peer media controls** — mute or hide individual peers without affecting anyone else.
- **Abscond** — request a private breakout room with a specific person in a group. They accept or decline; if they decline you can't tell the difference from being ignored.
- **VPN kill switch** — bind to a specific network interface. If that interface goes down, all connections are killed immediately and new ones are blocked until it comes back.
- **Zero persistence** — no chat logs, no peer IDs, no session data written to disk. The only file the app ever touches is `settings.json` for your interface preference.

---

## Privacy

Narciso is honest about what it is and what it isn't.

**What it does:** Routes all communication directly between peers using WebRTC. No server ever sees your messages, your voice, or your video. There are no accounts, no analytics, no telemetry, no logs anywhere.

**What it doesn't do:** Hide your IP address. When you connect to someone through Narciso, they can see your real IP address, and you can see theirs. This is true of all WebRTC applications and is a fundamental property of direct peer-to-peer connections. From an IP address, someone can determine your approximate location, your ISP, and potentially more.

**Our recommendation:** Use a VPN. Narciso has a built-in VPN kill switch under ⚙ Settings that lets you bind to a specific network interface — typically your VPN adapter. If that interface goes down for any reason, Narciso kills all active connections and refuses new ones until it comes back. This prevents accidental exposure if your VPN drops mid-session.

**What Narciso does not protect against:**
- IP address exposure to peers (use a VPN)
- Someone screenshotting or recording their screen
- Compromised devices on either end
- Anyone the BitTorrent trackers themselves log (they see your IP when you query them, same as any torrent client)

The privacy disclaimer that appears on launch is not dismissible with a "don't show again" checkbox. You see it every time. This is intentional.

---

## How it works

1. **Peer discovery via BitTorrent trackers.** When you join a room or enter the random lobby, Narciso announces your presence to a set of BitTorrent trackers using the room name as a torrent info-hash. Other peers in the same room do the same. The tracker tells you who else is there.

2. **WebRTC signaling through the tracker.** Trystero ferries WebRTC SDP offers, answers, and ICE candidates between peers using the tracker's peer messaging channel. This is the only moment any external infrastructure is involved.

3. **Direct encrypted connections.** Once the WebRTC handshake completes, the tracker is out of the picture. All audio, video, and text flows directly between peers, encrypted with DTLS (WebRTC's built-in transport encryption). No relay server, no TURN server, no intermediary of any kind.

4. **Everything is in-memory only.** Nicknames are generated fresh on each launch. Nothing is written to disk except your interface preference in `settings.json`.

---

## Known terminal noise

When a peer disconnects (Next, Leave, closing the app, etc.) you may see lines like
`Sctp:` or `usrsctp` errors printed to the terminal. These come from Chromium's
native WebRTC/SCTP layer tearing down a data channel and are harmless — they don't
indicate a bug, a leak, or a failed connection. They cannot be fully suppressed
from the app itself, since they're written directly to stderr by native code below
Chromium's own logging system.

You may also see `stun_port.cc` binding timeout messages during ICE negotiation.
This is normal WebRTC behavior — STUN requests can time out against some servers
while others succeed — and doesn't indicate a failed connection. Like the SCTP
messages above, these come from native code below Chromium's logging system and
can't be suppressed from the app.

---

## Building from source

```bash
npm install
npm start
```

`npm start` bundles the renderer with esbuild and launches Electron. That's it.

---

## Packaging

*(Coming soon — electron-builder configuration in progress.)*

---

## Tech stack

| Thing | What |
|---|---|
| [Electron](https://www.electronjs.org/) | Desktop shell |
| [Trystero](https://github.com/dmotz/trystero) (torrent strategy) | P2P peer discovery and signaling via BitTorrent trackers |
| WebRTC | Direct encrypted audio/video/data connections |
| [esbuild](https://esbuild.github.io/) | Renderer bundling |

No frameworks. No UI library. No state management. Just a renderer, a main process, and a lot of faith in BitTorrent trackers.

---

## License

GNU Affero General Public License v3.0 (AGPL-3.0)

If you modify this and deploy it somewhere, your source has to be open too. That feels right for a tool built specifically to avoid centralized control.
