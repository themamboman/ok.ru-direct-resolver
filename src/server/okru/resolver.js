import { fetchOkruEmbed } from '../http/client.js';
import { OKRU_ORIGIN, OKRU_REFERER } from './constants.js';
import { cdnHosts, decodeEmbedMetadata, hlsMasterUrl } from './embed.js';
import { openHlsMaster, qualitiesFromMaster } from './hls.js';

export async function resolveVideo(videoId) {
  const page = await fetchOkruEmbed(videoId);
  if (page.status >= 400) {
    throw new Error(`Could not load embed page (HTTP ${page.status})`);
  }

  const meta = decodeEmbedMetadata(page.body);
  const hls = hlsMasterUrl(meta);
  if (!hls) {
    throw new Error('No HLS manifest in player metadata');
  }

  const master = await openHlsMaster(hls, cdnHosts(meta));
  const qualities = qualitiesFromMaster(master.body, master.url);
  if (!qualities.length) {
    throw new Error('No qualities in HLS master');
  }

  const movie = meta.movie || {};
  const best = qualities[0];
  return {
    videoId,
    title: movie.title ?? null,
    hls: master.url,
    referer: OKRU_REFERER,
    origin: OKRU_ORIGIN,
    qualities,
    durationSec: parseInt(movie.duration, 10) || 0,
    width: best.width ?? movie.width,
    height: best.height ?? movie.height,
  };
}
