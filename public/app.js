import { parseVideoId } from '/lib/parse-video-id.js';

const $ = (id) => document.getElementById(id);
const ui = {
  form: $('resolve-form'),
  input: $('video-id-input'),
  status: $('status'),
  result: $('result-section'),
  timers: $('timers'),
  video: $('video'),
  meta: $('meta'),
  submit: $('submit-btn'),
  resolveTime: $('resolve-time'),
  playTime: $('play-time'),
  directLink: $('direct-link'),
  proxyLink: $('proxy-link'),
  qualities: $('qualities'),
};

let session = 0;
let resolved = null;
let qualityIndex = 0;
let hls = null;

const formatMs = (ms) => {
  if (!Number.isFinite(ms)) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
};

const timer = (el) => {
  let frame = 0;
  let start = 0;
  return {
    tick(active) {
      cancelAnimationFrame(frame);
      start = performance.now();
      const loop = () => {
        if (!active()) return;
        el.textContent = formatMs(performance.now() - start);
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    },
    freeze() {
      cancelAnimationFrame(frame);
      el.textContent = formatMs(performance.now() - start);
    },
    stop() {
      cancelAnimationFrame(frame);
    },
  };
};

const resolveTimer = timer(ui.resolveTime);
const playTimer = timer(ui.playTime);
let playing = false;

const setStatus = (text, type = '') => {
  ui.status.textContent = text;
  ui.status.className = type ? `status ${type}` : 'status';
};

const setLink = (el, url) => {
  el.textContent = url;
  el.dataset.url = url;
};

const proxyUrl = (url, referer, origin) => {
  const params = new URLSearchParams({ url, referer });
  if (origin) params.set('origin', origin);
  return `/api/stream?${params}`;
};

const destroyHls = () => {
  hls?.destroy();
  hls = null;
};

const hlsLevel = (quality) => {
  if (!hls?.levels?.length) return -1;
  const bySize = hls.levels.findIndex((level) => (
    level.width === quality.width && level.height === quality.height
  ));
  return bySize >= 0 ? bySize : hls.levels.findIndex((level) => level.name === quality.quality);
};

const syncQuality = (index) => {
  const quality = resolved.qualities[index];
  if (!quality) return;
  qualityIndex = index;
  const proxied = proxyUrl(quality.url, resolved.referer, resolved.origin);
  setLink(ui.directLink, quality.url);
  setLink(ui.proxyLink, new URL(proxied, location.origin).href);
  ui.qualities.querySelectorAll('button').forEach((btn, i) => {
    btn.classList.toggle('is-active', i === index);
  });
  const level = hlsLevel(quality);
  if (level >= 0) hls.currentLevel = level;
};

const reset = () => {
  resolveTimer.stop();
  playTimer.stop();
  playing = false;
  ui.timers.hidden = true;
  ui.result.hidden = true;
  destroyHls();
  ui.video.removeAttribute('src');
  ui.video.load();
  ui.meta.textContent = '';
  ui.resolveTime.textContent = '—';
  ui.playTime.textContent = '—';
  ui.directLink.textContent = '';
  ui.directLink.removeAttribute('data-url');
  ui.proxyLink.textContent = '';
  ui.proxyLink.removeAttribute('data-url');
  ui.qualities.replaceChildren();
  ui.qualities.hidden = true;
  resolved = null;
  qualityIndex = 0;
  session += 1;
};

const renderQualities = (qualities) => {
  ui.qualities.replaceChildren();
  if (qualities.length < 2) {
    ui.qualities.hidden = true;
    return;
  }
  qualities.forEach((quality, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = quality.label;
    btn.classList.toggle('is-active', index === qualityIndex);
    btn.addEventListener('click', () => syncQuality(index));
    ui.qualities.append(btn);
  });
  ui.qualities.hidden = false;
};

const startPlayback = (payload, token) => {
  syncQuality(qualityIndex);
  const master = proxyUrl(payload.hls, payload.referer, payload.origin);
  if (!window.Hls?.isSupported()) {
    if (!ui.video.canPlayType('application/vnd.apple.mpegurl')) {
      throw new Error('HLS playback is not supported in this browser');
    }
    ui.video.src = master;
    ui.video.load();
    ui.video.play().catch(() => {});
    return;
  }
  destroyHls();
  hls = new window.Hls();
  hls.loadSource(master);
  hls.attachMedia(ui.video);
  hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
    if (token !== session) return;
    const level = hlsLevel(payload.qualities[qualityIndex]);
    if (level >= 0) hls.currentLevel = level;
    ui.video.play().catch(() => {});
  });
};

const watchPlayback = (token) => {
  const done = () => {
    if (!playing || token !== session) return;
    playing = false;
    playTimer.freeze();
    setStatus('Stream ready · playback running', 'ok');
  };
  ui.video.addEventListener('playing', done, { once: true });
  ui.video.addEventListener('loadeddata', () => {
    if (ui.video.readyState >= 2) done();
  }, { once: true });
};

const resolve = async (videoId) => {
  setStatus('Resolving stream…');
  ui.submit.disabled = true;
  reset();
  const token = session;
  ui.timers.hidden = false;
  resolveTimer.tick(() => token === session);

  try {
    const response = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (token !== session) return;

    resolveTimer.freeze();
    resolved = payload;
    qualityIndex = 0;
    renderQualities(payload.qualities);
    ui.meta.textContent = [
      payload.title,
      payload.videoId,
      payload.width && payload.height ? `${payload.width}×${payload.height}` : null,
      payload.durationSec ? `${payload.durationSec}s` : null,
    ].filter(Boolean).join(' · ');
    ui.result.hidden = false;
    playing = true;
    playTimer.tick(() => playing && token === session);
    setStatus('Stream ready · starting playback…');
    watchPlayback(token);
    startPlayback(payload, token);
  } catch (error) {
    resolveTimer.stop();
    playTimer.stop();
    playing = false;
    if (token === session) setStatus(error.message || 'Could not resolve stream', 'error');
  } finally {
    ui.submit.disabled = false;
  }
};

ui.form.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    resolve(parseVideoId(ui.input.value));
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

ui.video.addEventListener('error', () => {
  playing = false;
  playTimer.stop();
  if (ui.video.error) setStatus(`Playback failed (${ui.video.error.code})`, 'error');
});

document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const el = $(btn.dataset.copyTarget);
    const url = el?.dataset.url || el?.textContent || '';
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      const label = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = label; }, 1200);
    } catch {
      setStatus('Copy failed', 'error');
    }
  });
});
