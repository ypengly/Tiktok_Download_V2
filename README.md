# TikSave — TikTok Video Downloader

A fast, mobile-first TikTok video downloader with a clean SaaS-style UI and an Express backend backed by a live media provider.

## Features

- Paste-a-link downloader flow with client- and server-side validation
- Video preview card (thumbnail, author, title, duration, download options)
- Loading spinner, skeleton loading state, disabled button while processing
- Error and success states, toast notifications
- Copy-link and clear/reset actions
- Dark/light mode toggle, responsive mobile-first layout with hamburger nav
- Accessible: semantic HTML, visible focus states, `prefers-reduced-motion` support
- Abstracted provider layer (`services/tiktokService.js`) — swap in a compatible provider without touching routes or frontend
- Security basics: input validation, rate limiting, request size limits, CORS, no open proxy/SSRF surface

## Project structure

```
tiktok-downloader/
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── services/
│   └── tiktokService.js
├── server.js
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## Getting started

```bash
npm install
cp .env.example .env
npm start
```

Visit `http://localhost:3000`.

The default configuration uses the live TikWM API. The backend does not return mock metadata: provider failures are reported to the user and no fake download links are generated.

## Connecting a real provider

TikTok doesn't offer a public first-party download API, so this project deliberately keeps the provider abstracted behind one function:

```js
// services/tiktokService.js
async function getTikTokVideo(url) { ... }
```

To go live:

1. Choose a metadata/download provider (self-hosted or third-party) that you are comfortable relying on and that respects TikTok's terms.
2. Set `TIKTOK_API_ENDPOINT` and, when required, `TIKTOK_API_KEY` in `.env`.
3. If the provider does not use the TikWM-compatible request and response shape, adjust `fetchFromProvider()` in `services/tiktokService.js`. Nothing else in the app needs to change.

The API key never reaches the browser; it's read from environment variables on the server only.

## API

### `POST /api/download`

**Request**

```json
{ "url": "https://www.tiktok.com/@user/video/123456789" }
```

**Response**

```json
{
  "success": true,
  "video": {
    "title": "...",
    "author": "...",
    "thumbnail": "...",
    "duration": 30,
    "downloads": [{ "quality": "HD", "format": "MP4", "url": "..." }]
  }
}
```

Invalid or non-TikTok URLs return `400` with a `success: false` and a human-readable `error` message. Provider failures return `502` with a friendly error rather than a stack trace.

### `GET /api/status`

Returns `{ success: true, provider: string }` for a basic operational check.

## Security notes

- Only `https://*.tiktok.com` hostnames are accepted — the endpoint cannot be used as a general-purpose URL fetcher (no open proxy / SSRF surface).
- JSON body size is capped at 10kb.
- `/api/*` is rate-limited (defaults: 20 requests/minute per IP — tune via `.env`).
- CORS is locked to `ALLOWED_ORIGINS` when `NODE_ENV=production`.
- All errors are caught and converted to generic, user-facing messages; internals are logged server-side only.

## Deployment

Works on any Node host. Quick paths:

**Render / Railway**

1. Push this repo to GitHub.
2. Create a new Web Service, connect the repo.
3. Build command: `npm install` — Start command: `npm start`.
4. Add the environment variables from `.env.example` in the dashboard.

**Vercel**
Vercel's Node runtime favors serverless functions over a long-running Express app. Either:

- Deploy as-is using a `vercel.json` that routes all requests to `server.js` as a serverless function, or
- Split `server.js`'s route handlers into `/api` functions for a more idiomatic Vercel setup.

In all cases, set `TIKTOK_API_ENDPOINT`, `TIKTOK_API_KEY`, and `ALLOWED_ORIGINS` in your host's environment variable settings — never commit `.env`.

## Responsible use

TikSave is built for saving content you have the right to save — your own videos, or ones a creator has given you permission to keep. It doesn't store submitted links beyond the request that processes them, and it doesn't collect personal information. Please respect creators' copyrights and TikTok's terms of service.

This project is not affiliated with or endorsed by TikTok.
