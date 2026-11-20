const HOST = 'aibootcamp-skku.co.kr';
const ARTICLE = /^https:\/\/aibootcamp-skku\.co\.kr\/news\/[0-9]+$/i;
const IMAGE = /^https:\/\/aibootcamp-skku\.co\.kr\/data\/(?:file\/news|editor\/[0-9]{4})\/[a-z0-9_-]+\.(?:png|jpe?g|gif|webp)$/i;

export function isAiBootcampArticle(value: string): boolean {
  return ARTICLE.test(value) && /\/news\/[0-9]+$/.test(value) && !/[\r\n]/.test(value);
}

export function allowAiBootcampBodyUrl(value: string, image: boolean): boolean {
  try {
    const url = new URL(value);
    const authority = value.match(/^https?:\/\/([^/?#]*)/i)?.[1].toLowerCase() ?? '';
    if (!url.hostname.includes(HOST) && !authority.includes(HOST)) return true;
    return image ? IMAGE.test(value) && /^\/data\/(?:file\/news|editor\/)/.test(url.pathname)
      && !/[\r\n]/.test(value) : isAiBootcampArticle(value);
  } catch {
    return false;
  }
}
