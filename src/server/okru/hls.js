import { fetchCdnText } from '../http/client.js';
import { CDN_MASTER_TIMEOUT_MS, OKRU_ORIGIN, OKRU_REFERER } from './constants.js';

const STREAM_INF = '#EXT-X-STREAM-INF:';

const withHost = (url, host) => {
  const next = new URL(url);
  next.hostname = host;
  return next.href;
};

const parseAttrs = (line) => {
  const attrs = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let match;
  while ((match = re.exec(line.slice(STREAM_INF.length)))) {
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    attrs[match[1]] = value;
  }
  return attrs;
};

export function qualitiesFromMaster(body, manifestUrl) {
  const base = new URL(manifestUrl);
  const variants = [];
  const lines = body.trim().split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith(STREAM_INF)) {
      continue;
    }
    const uri = lines[i + 1]?.trim();
    if (!uri || uri.startsWith('#')) {
      continue;
    }
    const attrs = parseAttrs(lines[i]);
    const resolution = attrs.RESOLUTION ?? null;
    const [width, height] = resolution
      ? resolution.split('x').map((part) => parseInt(part, 10))
      : [null, null];
    variants.push({
      quality: attrs.QUALITY ?? null,
      width: Number.isFinite(width) ? width : null,
      height: Number.isFinite(height) ? height : null,
      bandwidth: parseInt(attrs.BANDWIDTH, 10) || 0,
      url: new URL(uri, base).href,
      label: resolution ? resolution.replace('x', '×') : attrs.QUALITY,
    });
    i += 1;
  }
  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return variants;
}

export async function openHlsMaster(url, hosts) {
  if (!hosts.length) {
    throw new Error('No CDN hosts in player metadata');
  }

  const headers = { referer: OKRU_REFERER, origin: OKRU_ORIGIN };
  const open = (host) => {
    const candidate = withHost(url, host);
    return fetchCdnText(candidate, headers, CDN_MASTER_TIMEOUT_MS).then((res) => {
      if (res.status === 200 && res.body.startsWith('#EXTM3U')) {
        return { body: res.body, url: candidate };
      }
      throw new Error(`HLS master unavailable (HTTP ${res.status})`);
    });
  };

  try {
    return await Promise.any(hosts.map(open));
  } catch (error) {
    if (error instanceof AggregateError && error.errors.length) {
      throw error.errors[0];
    }
    throw error;
  }
}

export function rewriteM3u8(body, manifestUrl, referer, origin) {
  const base = new URL(manifestUrl);
  return body.split(/\r?\n/).map((line) => {
    if (!line || line.startsWith('#')) {
      return line;
    }
    const params = new URLSearchParams({
      url: new URL(line, base).href,
      referer,
      origin: origin || OKRU_ORIGIN,
    });
    return `/api/stream?${params}`;
  }).join('\n');
}
