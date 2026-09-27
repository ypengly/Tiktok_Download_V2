require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fetch = require('node-fetch');
const { getTikTokVideo } = require('./services/tiktokService');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Security & parsing middleware
// ---------------------------------------------------------------------------

app.use(express.json({ limit: '10kb' }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (process.env.NODE_ENV !== 'production' || !origin || allowedOrigins.length === 0) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
  })
);

const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please wait a moment and try again.' },
});
app.use('/api/', apiLimiter);

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

const TIKTOK_HOST_PATTERN = /^([a-z0-9-]+\.)*tiktok\.com$/i;

// Media can come from TikTok CDNs, the provider's own CDN (TikWM),
// or ByteDance infra that TikWM proxies through.
const MEDIA_HOST_PATTERN =
  /(^|\.)(tiktokcdn(-[a-z0-9-]+)?\.com|tiktokcdn\.us|tiktokcdn-us\.com|tiktokv\.com|tikwm\.com|byteoversea\.com|ibyteimg\.com|muscdn\.com|musical\.ly|tiktok\.com)$/i;

function isValidTikTokUrl(raw) {
  if (!raw || typeof raw !== 'string') return false;
  if (raw.length > 500) return false;

  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  return TIKTOK_HOST_PATTERN.test(parsed.hostname);
}

function isValidMediaUrl(raw) {
  if (!raw || typeof raw !== 'string' || raw.length > 5000) return false;

  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' && MEDIA_HOST_PATTERN.test(parsed.hostname);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.post('/api/download', async (req, res) => {
  const { url } = req.body || {};

  if (!isValidTikTokUrl(url)) {
    return res.status(400).json({
      success: false,
      error:
        'Please enter a valid TikTok video URL (tiktok.com, vm.tiktok.com, or vt.tiktok.com).',
    });
  }

  try {
    const video = await getTikTokVideo(url.trim());
    return res.json({ success: true, video });
  } catch (err) {
    console.error('[download] provider error:', err.message);
    return res.status(502).json({
      success: false,
      error: 'We could not retrieve that video right now. Please try again in a moment.',
    });
  }
});

// ---------------------------------------------------------------------------
// File proxy — filename lives in the URL path so the browser always saves
// with the correct name + extension, even if a proxy strips our headers.
// ---------------------------------------------------------------------------
app.get('/api/file/:filename', async (req, res) => {
  const mediaUrl = req.query.url;
  const requestedType = req.query.type === 'audio' ? 'audio' : 'video';
  const defaultExt = requestedType === 'audio' ? 'mp3' : 'mp4';

  if (!isValidMediaUrl(mediaUrl)) {
    const host = (() => {
      try {
        return new URL(mediaUrl).hostname;
      } catch {
        return 'missing';
      }
    })();
    console.warn('[file] rejected URL by host pattern:', mediaUrl);
    return res.status(400).json({
      success: false,
      error: `Invalid download URL. Host not allowed: ${host}`,
    });
  }

  let safeName = path
    .basename(req.params.filename || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .trim();

  if (!safeName) safeName = `tiksave-${Date.now()}.${defaultExt}`;
  if (!/\.(mp4|mp3|m4a|webm|mov)$/i.test(safeName)) {
    safeName = `${safeName}.${defaultExt}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const upstream = await fetch(mediaUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.tiktok.com/',
        Origin: 'https://www.tiktok.com',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      console.error('[file] upstream failed:', upstream.status, text.slice(0, 300));
      return res.status(502).json({
        success: false,
        error: `Upstream returned ${upstream.status}. The media may have expired.`,
      });
    }

    const upstreamType = upstream.headers.get('content-type') || '';
    const contentType =
      requestedType === 'audio'
        ? 'audio/mpeg'
        : upstreamType.split(';')[0].trim() || 'video/mp4';

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
    );
    if (upstream.headers.get('content-length')) {
      res.setHeader('Content-Length', upstream.headers.get('content-length'));
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');

    upstream.body.pipe(res);
  } catch (err) {
    console.error('[file] fetch error:', err.name, err.message);
    if (!res.headersSent) {
      res.status(502).json({
        success: false,
        error: `Fetch failed: ${err.name} - ${err.message}`,
      });
    }
  } finally {
    clearTimeout(timeout);
  }
});

// ---------------------------------------------------------------------------
// Thumbnail proxy
// ---------------------------------------------------------------------------
app.get('/api/thumbnail', async (req, res) => {
  const imageUrl = req.query.url;
  if (!isValidMediaUrl(imageUrl)) {
    return res.status(400).end();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(imageUrl, {
      headers: { 'User-Agent': 'TikSave/1.0' },
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      return res.status(404).end();
    }

    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    response.body.pipe(res);
  } catch {
    if (!res.headersSent) res.status(404).end();
  } finally {
    clearTimeout(timeout);
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    provider: process.env.TIKTOK_API_ENDPOINT || 'TikWM',
  });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

app.use((err, req, res, next) => {
  console.error('[unhandled]', err.message);
  res.status(500).json({ success: false, error: 'Something went wrong on our end.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`TikSave server running on port ${PORT}`);
    console.log(`Downloader provider: ${process.env.TIKTOK_API_ENDPOINT || 'TikWM'}`);
  });
}

module.exports = app;