# SiteSurveyor AI host server

Runs the whole AI stack from ONE PC. Other devices — laptops, tablets,
phones — just open a browser; **nothing is installed on them**.

```
┌────────────────────────── host PC ──────────────────────────┐
│  OpenClaw gateway (loopback :18789)                          │
│        ▲                                                     │
│        │  /openclaw WS (Origin stripped → trusted loopback)  │
│  ai-gateway-server.ts (:8787, LAN)                          │
│        ▲                                                     │
│  frontend/dist (the SiteSurveyor app + PWA)                  │
└──────────────┬───────────────────────────┬───────────────────┘
               │                           │
        office laptop                  phone / tablet
   http://<host-ip>:8787         http://<host-ip>:8787
```

## One-time setup (host PC)

```bash
cd frontend && npm install && npm run build
cd ../server && npm install
```

## Run

```bash
npm start          # in server/
```

Auto-start at logon: `sitesurveyor-host.cmd` is placed in the Startup folder
(`Win+R` → `shell:startup`).

## Connect from other devices

Same Wi-Fi/LAN — open:  `http://<host-ip>:8787`
Find the IP with `ipconfig` (e.g. `192.168.1.198`). Sign in as usual; the
SiteSurveyor AI page works immediately.

On phones: browser menu → *Add to Home screen* — the app is a PWA and
installs like an app.

### Windows Firewall

First start may trigger Windows' "Allow Node.js" prompt — click **Allow**
(private networks). To open the port explicitly, run once as Administrator:

```powershell
netsh advfirewall firewall add rule name="SiteSurveyor Host 8787" dir=in action=allow protocol=TCP localport=8787
```

### Access from anywhere (mobile data / remote sites)

Install [Tailscale](https://tailscale.com) on the host PC and on the device,
then use `http://<tailscale-ip-of-host>:8787` from anywhere. Traffic is
WireGuard-encrypted end-to-end; no router port-forwarding, no exposure of the
gateway to the public internet.

## Security model

- The OpenClaw gateway binds to **loopback only** — it is never reachable
  from the network directly.
- The host server only forwards `/openclaw` WebSocket calls and strips the
  Origin header so the gateway treats them as trusted loopback clients.
- Platform data stays protected by Supabase Auth + RLS; AI chat requires a
  signed-in account, and every conversation is stored per user.
