const LEGACY_MARKER = '&quot;metadata&quot;:&quot;';
const MARKER = '&quot;metadata&quot;:{';

const unescapeLegacyMetadata = (raw) => raw
  .replace(/\\&quot;/g, '"')
  .replace(/\\\\u0026/g, '&')
  .replace(/\\u0026/g, '&')
  .replace(/\\\\/g, '\\');

const ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>', '#39': "'" };

const decodeEntities = (raw) => raw.replace(/&(quot|amp|lt|gt|#39);/g, (_, name) => ENTITIES[name]);

const extractObject = (raw) => {
  const jsonStart = raw.indexOf('{');
  if (jsonStart < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = jsonStart; i < raw.length; i += 1) {
    const char = raw[i];
    if (inString) {
      if (char === '\\') i += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}' && (depth -= 1) === 0) {
      return JSON.parse(raw.slice(jsonStart, i + 1));
    }
  }
  return null;
};

export function decodeEmbedMetadata(html) {
  let meta = null;
  const start = html.indexOf(MARKER);
  if (start >= 0) {
    const end = html.indexOf('"', start);
    meta = extractObject(decodeEntities(html.slice(start + MARKER.length - 1, end < 0 ? undefined : end)));
  } else {
    const legacyStart = html.indexOf(LEGACY_MARKER);
    if (legacyStart >= 0) {
      meta = extractObject(unescapeLegacyMetadata(html.slice(legacyStart + LEGACY_MARKER.length, legacyStart + LEGACY_MARKER.length + 25000)));
    }
  }
  if (!meta || typeof meta !== 'object') {
    throw new Error('Could not read player metadata');
  }
  return meta;
}

export const hlsMasterUrl = (meta) => meta.hlsManifestUrl ?? meta.ondemandHls ?? null;

const hostFrom = (value) => {
  if (!value) return null;
  if (!value.includes('://')) return value;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
};

const hostRank = (host) => {
  if (host.endsWith('.okcdn.ru')) return 0;
  if (host.includes('vkuser.net')) return 2;
  return 1;
};

export function cdnHosts(meta) {
  const hosts = [];
  for (const video of meta.videos || []) {
    const host = hostFrom(video.url);
    if (host) hosts.push(host);
  }
  for (const value of [hlsMasterUrl(meta), ...(meta.failoverHosts || [])]) {
    const host = hostFrom(value);
    if (host) hosts.push(host);
  }
  return [...new Set(hosts)].sort((a, b) => hostRank(a) - hostRank(b));
}
