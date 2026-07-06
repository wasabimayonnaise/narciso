# Security & Threat Model

Narciso is a serverless, zero-persistence P2P chat app. This document is honest
about what it protects and — just as importantly — what it does not. If you rely
on Narciso for anything that matters, read this.

## The core assumption: your peer is untrusted

Narciso is peer-to-peer. Once two people connect, their apps talk directly and
there is no server in the middle to enforce anything. **Assume the person on the
other end is running modified software and logging everything they can.** Narciso
is built so that assumption is safe for the things it *can* protect — and clear
about the things it can't.

## What Narciso protects

- **No servers, no logs, no accounts.** Peer discovery uses public BitTorrent
  trackers; after that, all traffic is a direct WebRTC connection. No message,
  voice, or video ever passes through a server we run — there isn't one.
- **Encryption in transit.** All peer traffic (text, files, audio, video) rides
  WebRTC's DTLS/SRTP encryption.
- **Ephemeral by design.** Nicknames are random per launch. Nothing is written to
  disk except your network-interface preference. Close the app and the session is
  gone.
- **Image metadata stripping.** Images are re-encoded before sending, removing
  EXIF/GPS/device data. If an image can't be decoded (e.g. HEIC), it is refused
  rather than sent with metadata intact.
- **Media container metadata stripping.** MP4/MOV/M4A files have their
  `udta`/`meta` boxes (GPS location, device make/model, tags) blanked before
  sending.
- **Filename neutralization.** Filenames leak dates, device models, OS locale,
  and personal names. Narciso never transmits the real filename — only a neutral
  name like `image-a3f9.png`. You still see the real name in your own chat.

## What Narciso does NOT protect against

- **Your IP address is visible to your peer.** This is fundamental to WebRTC and
  all direct peer-to-peer connections — there is no way around it while keeping
  direct, serverless media. From your IP a peer can learn your approximate
  location and ISP. **If this matters to you, use a VPN at the OS/network level.**
  Narciso includes a VPN kill switch (bind to an interface; connections drop if
  it goes down). It cannot route WebRTC media through Tor — Tor is TCP-only and
  WebRTC media is UDP, so onion-routing the connection would require a relay
  server and would break real-time voice/video anyway.
- **The trackers see your IP.** When you query a BitTorrent tracker to find peers,
  it sees your IP, the same as any torrent client.
- **Recording.** A peer can screenshot or screen-record anything you send or say.
  Nothing prevents this.
- **Compromised endpoints.** If your device or your peer's is compromised, no
  app-level protection helps.
- **Metadata we don't strip.** MP3/ID3, WebM, and MKV container metadata is *not*
  stripped (you're warned once when sending these). Document formats (PDF, Office)
  can embed author/software/timestamps that Narciso does not remove. Creation-time
  fields inside MP4 structural boxes are left intact. Strip sensitive files
  yourself before sending.

## Recommendation

Use a VPN. Assume your peer can see your IP and can record the conversation.
Narciso removes the metadata it reliably can and is honest about the rest — it
does not, and cannot, make you anonymous to the person you are talking to.

## Reporting a vulnerability

Please report security issues privately via GitHub's
[private vulnerability reporting](https://github.com/wasabimayonnaise/narciso/security/advisories/new)
rather than opening a public issue.
