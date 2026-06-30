const MARKER = '&quot;metadata&quot;:&quot;';

const unescapeMetadata = (raw) => raw
  .replace(/\\&quot;/g, '"')
  .replace(/\\\\u0026/g, '&')
  .replace(/\\u0026/g, '&')
  .replace(/\\\\/g, '\\');

export function decodeEmbedMetadata(html) {
  const start = html.indexOf(MARKER);
  if (start < 0) {
    throw new Error('Could not read player metadata');
  }
  const raw = unescapeMetadata(html.slice(start + MARKER.length, start + MARKER.length + 25000));
  const jsonStart = raw.indexOf('{');
  if (jsonStart < 0) {
    throw new Error('Could not read player metadata');
  }
  let depth = 0;
  for (let i = jsonStart; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === '{') depth += 1;
    else if (char === '}' && (depth -= 1) === 0) {
      const meta = JSON.parse(raw.slice(jsonStart, i + 1));
      if (!meta || typeof meta !== 'object') {
        throw new Error('Could not read player metadata');
      }
      return meta;
    }
  }
  throw new Error('Could not read player metadata');
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
