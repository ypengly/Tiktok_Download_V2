const fetch = require('node-fetch');

function sanitizeFilename(name, fallback = 'tiktok') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

async function fetchFromProvider(url) {
  const endpoint = process.env.TIKTOK_API_ENDPOINT || 'https://tikwm.com/api/';
  const apiKey = process.env.TIKTOK_API_KEY;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        Referer: 'https://www.tiktok.com/',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: new URLSearchParams({ url, hd: '1' }).toString(),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Provider responded with status ${response.status}`);
    }

    const payload = await response.json();
    if (payload.code !== 0 || !payload.data) {
      throw new Error(payload.msg || 'Provider returned no video data');
    }

    const data = payload.data;

    const base = sanitizeFilename(
      `${data.author?.unique_id || data.author?.nickname || 'tiktok'}-${data.id || Date.now()}`
    );

    // Build raw list first, then add downloadUrl for each
    const raw = [
      data.hdplay && {
        quality: 'HD',
        format: 'MP4',
        type: 'video',
        url: data.hdplay,
        filename: `${base}-hd.mp4`,
      },
      data.play && {
        quality: 'Standard',
        format: 'MP4',
        type: 'video',
        url: data.play,
        filename: `${base}.mp4`,
      },
      data.wmplay && {
        quality: 'SD',
        format: 'MP4',
        type: 'video',
        url: data.wmplay,
        filename: `${base}-sd.mp4`,
      },
      data.music && {
        quality: 'Audio',
        format: 'MP3',
        type: 'audio',
        url: data.music,
        filename: `${base}.mp3`,
      },
    ].filter(Boolean);

    if (!raw.length) {
      throw new Error('Provider returned no downloadable media');
    }

    const downloads = raw.map((item) => ({
      quality: item.quality,
      format: item.format,
      url: item.url,
      filename: item.filename,
      downloadUrl:
        `/api/file/${encodeURIComponent(item.filename)}` +
        `?url=${encodeURIComponent(item.url)}` +
        `&type=${encodeURIComponent(item.type)}`,
    }));

    return {
      title: data.title || 'Untitled video',
      author: data.author?.nickname || data.author?.unique_id || 'Unknown creator',
      thumbnail: data.cover || data.origin_cover || data.thumbnail || '',
      duration: data.duration || 0,
      downloads,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getTikTokVideo(url) {
  return fetchFromProvider(url);
}

module.exports = { getTikTokVideo };