import http2 from 'node:http2';
import https from 'node:https';
import tls from 'node:tls';
import {
  brotliDecompressSync,
  createBrotliDecompress,
  createGunzip,
  createUnzip,
  gunzipSync,
} from 'node:zlib';
import { CDN_STREAM_TIMEOUT_MS, OKRU_ORIGIN } from '../okru/constants.js';
import { documentHeaders, fetchHeaders } from './browser-headers.js';

const SSL_OP_TLSEXT_PADDING = 1 << 4;
const SSL_OP_NO_ENCRYPT_THEN_MAC = 1 << 19;

const CHROME_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':');

const H2_SETTINGS = {
  headerTableSize: 65536,
  enablePush: false,
  initialWindowSize: 6291456,
  maxFrameSize: 16384,
  maxConcurrentStreams: 1000,
  maxHeaderListSize: 262144,
};

const cdnAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });

let okruSession;

const tlsOptions = (hostname, alpn) => ({
  host: hostname,
  port: 443,
  servername: hostname,
  ALPNProtocols: alpn,
  ciphers: CHROME_CIPHERS,
  sigalgs:
    'ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:rsa_pss_rsae_sha512:rsa_pkcs1_sha512',
  ecdhCurve: 'X25519:prime256v1:secp384r1',
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  secureOptions: SSL_OP_TLSEXT_PADDING | SSL_OP_NO_ENCRYPT_THEN_MAC,
});

const decodeBody = (buffer, encoding) => {
  if (encoding === 'br') return brotliDecompressSync(buffer);
  if (encoding === 'gzip') return gunzipSync(buffer);
  return buffer;
};

const bodyDecompressStream = (encoding) => {
  if (encoding === 'br') return createBrotliDecompress();
  if (encoding === 'gzip') return createGunzip();
  if (encoding === 'deflate') return createUnzip();
  return null;
};

const okruSessionFor = (origin) => {
  if (okruSession && !okruSession.closed && !okruSession.destroyed) return okruSession;
  const host = new URL(origin).hostname;
  okruSession = http2.connect(origin, {
    settings: H2_SETTINGS,
    createConnection: () => tls.connect(tlsOptions(host, ['h2', 'http/1.1'])),
  });
  okruSession.on('error', () => { okruSession = null; });
  okruSession.on('close', () => { okruSession = null; });
  return okruSession;
};

const fetchCdn = (urlStr, extraHeaders, stream, timeoutMs = CDN_STREAM_TIMEOUT_MS) => new Promise((resolve, reject) => {
  const url = new URL(urlStr);
  const req = https.request(
    {
      hostname: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      agent: cdnAgent,
      headers: { ...fetchHeaders(), ...extraHeaders },
      servername: url.hostname,
      ...tlsOptions(url.hostname, ['http/1.1']),
    },
    (res) => {
      if (stream) {
        const decompressor = bodyDecompressStream(res.headers['content-encoding']);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          stream: decompressor ? (res.pipe(decompressor), decompressor) : res,
        });
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: decodeBody(Buffer.concat(chunks), res.headers['content-encoding']).toString('binary'),
        });
      });
    },
  );
  req.setTimeout(timeoutMs, () => {
    req.destroy(Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }));
  });
  req.on('error', reject);
  req.end();
});

export function fetchOkruEmbed(videoId) {
  return new Promise((resolve, reject) => {
    const req = okruSessionFor(OKRU_ORIGIN).request({
      ':method': 'GET',
      ':path': `/videoembed/${videoId}`,
      ':authority': 'ok.ru',
      ':scheme': 'https',
      ...documentHeaders(),
    });
    const chunks = [];
    req.on('response', (headers) => {
      const status = Number(headers[':status']);
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        resolve({
          status,
          headers,
          body: decodeBody(raw, headers['content-encoding']).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

export const fetchCdnText = (urlStr, extraHeaders, timeoutMs) => fetchCdn(urlStr, extraHeaders, false, timeoutMs);
export const fetchCdnStream = (urlStr, extraHeaders, timeoutMs) => fetchCdn(urlStr, extraHeaders, true, timeoutMs);
