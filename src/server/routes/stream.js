import { fetchCdnStream, fetchCdnText } from '../http/client.js';
import { OKRU_ORIGIN } from '../okru/constants.js';
import { rewriteM3u8 } from '../okru/hls.js';
import { sendJson } from '../lib/http-response.js';

const isPlaylistUrl = (url) => /\.m3u8/i.test(url) || /\/video\/?(\?|$)/i.test(url);

export async function handleStream(request, response, url) {
  const target = url.searchParams.get('url');
  const referer = url.searchParams.get('referer');
  if (!target || !referer) {
    sendJson(response, 400, { error: 'url and referer are required' });
    return;
  }

  try {
    const origin = url.searchParams.get('origin') || OKRU_ORIGIN;
    const headers = { referer, origin };
    if (request.headers.range) {
      headers.range = request.headers.range;
    } else if (request.method === 'HEAD') {
      headers.range = 'bytes=0-0';
    }

    if (request.method === 'GET' && isPlaylistUrl(target)) {
      const upstream = await fetchCdnText(target, headers);
      if (upstream.body.startsWith('#EXTM3U')) {
        response.writeHead(upstream.status, {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
        });
        response.end(rewriteM3u8(upstream.body, target, referer, origin));
        return;
      }
    }

    const upstream = await fetchCdnStream(target, headers);
    const out = {
      'Content-Type': upstream.headers['content-type'] ?? 'application/octet-stream',
      'Accept-Ranges': upstream.headers['accept-ranges'] ?? 'bytes',
      'Cache-Control': 'no-store',
    };
    if (upstream.headers['content-range']) out['Content-Range'] = upstream.headers['content-range'];
    if (upstream.headers['content-length']) out['Content-Length'] = upstream.headers['content-length'];

    response.writeHead(upstream.statusCode, out);
    if (request.method === 'HEAD') {
      upstream.stream.resume();
      response.end();
      return;
    }
    upstream.stream.pipe(response);
  } catch (error) {
    sendJson(response, 502, { error: error.message || 'Stream proxy failed' });
  }
}
