# Cosmic Space Portfolio

Personal portfolio of **Elcan Ismayilov** — Systems Architecture & Full Stack Software Engineer based in Baku, Azerbaijan.

Live site: **[elcanismayilov.com](https://elcanismayilov.com)**

A scroll-driven 3D flight through deep space, built with Three.js. The visitor pilots past a 90,000-star field and floating photogrammetry-scanned objects (satellites, radar dishes, PCs, audio gear), while a spaceship cockpit overlay serves as the site's navigation terminal.

## Features

- **WebGL space scene** — ~90k stars and 700 nebula sprites spread across a 36,000-unit depth, with scroll-momentum physics (inertia, damping, lerp-smoothed camera).
- **Photogrammetry cockpit** — GLB models (`3d/`) placed as floating exhibits along the flight path.
- **HUD overlays** — cockpit "NAV TERMINAL" menu, a Fallout-4-style compass band driven by the camera's world heading, and live depth/scroll counters.
- **Star Wars-style intro crawl** for the About sequence.
- **Dual layout** — phones and tablets get a dedicated lightweight page at `/m/`; detection runs client-side (UA + `maxTouchPoints` + `pointer: coarse`) and server-side, with a `?desktop=1` opt-out remembered via cookie/localStorage.
- **Custom 404** — countdown page that redirects to `/` or `/m/` per device.
- **SEO/OG ready** — Open Graph, Twitter cards, JSON-LD `Person` schema, sitemap, robots.txt, favicons.

## Tech stack

- **Three.js** (`GLTFLoader`) + [`@lucasmarkes/hairline`](https://www.npmjs.com/package/@lucasmarkes/hairline) models
- **Vite 6** — multi-page build (`index.html` + `m/index.html`), custom middleware plugin for `/3d`, `/font`, `/logo` assets and 404 routing
- **Python `serve.py`** — production static server for `dist/` with SPA fallback, cache headers, mobile UA redirects and Cloudflare Tunnel integration
- **GitHub Actions** — `deploy.yml` SSHes into an AWS EC2 host on every push to `main`, pulls, builds and restarts the `portfo` systemd service

## Getting started

```bash
npm install
npm run dev        # dev server on :5173
```

Build for production:

```bash
npm run build      # outputs dist/ (models, fonts, videos are copied in)
```

Serve the production build (optionally behind a Cloudflare Tunnel):

```bash
python serve.py               # dist/ on :8000 + cloudflared
python serve.py --build       # build first, then serve
python serve.py --no-tunnel   # local only
```

Tunnel selection order: `TUNNEL_TOKEN` env var → `TUNNEL_ID` env var → `cloudflared.yml` → free quick tunnel (`*.trycloudflare.com`).

## Project structure

```
index.html          Desktop entry — cockpit menu, HUD, crawl stages
m/index.html        Mobile/tablet entry (lightweight)
style.css           All site styles
src/main.js         Three.js scene, scroll physics, HUD wiring
3d/                 GLB models (antenna, satellite, radar dish, PCs, audio gear...)
font/               Custom webfonts
logo/               Logo images
videos/             Project showcase videos
public/             404.html, favicons, manifest, sitemap, robots.txt
vite.config.js      Asset middleware + dist copying + dev-server hosts
serve.py            Production server + Cloudflare Tunnel
.github/workflows/  CI deploy to AWS over SSH
```

## Deployment

Every push to `main` triggers the **Deploy to AWS** workflow, which SSHes into the EC2 host and runs `git pull → npm install → npm run build → systemctl restart portfo`. Public access is handled by a Cloudflare Tunnel terminating at `elcanismayilov.com`.

Required GitHub secrets: `AWS_HOST`, `AWS_USER`, `AWS_SSH_KEY`.

## License

Private — all rights reserved.
