const VIDEO_ID_RE = /^\d{8,}$/;

export function parseVideoId(input) {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter a video ID');
  const videoId = trimmed.match(/(?:\/video\/|^)(\d{8,})/)?.[1] ?? trimmed;
  if (!VIDEO_ID_RE.test(videoId)) throw new Error('Enter a valid ok.ru video ID or URL');
  return videoId;
}
