import { parseVideoId } from '../../lib/parse-video-id.js';
import { resolveVideo } from '../okru/resolver.js';
import { readJsonBody, sendJson } from '../lib/http-response.js';

export async function handleResolve(request, response) {
  try {
    const { videoId } = await readJsonBody(request);
    sendJson(response, 200, await resolveVideo(parseVideoId(videoId)));
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}
