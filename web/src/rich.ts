// 서버가 nh3로 정제한 본문 HTML을 화면에 그리기 전에 한 번 더 거른다(D-016).
// 학교 게시판에서 온 내용이라 허용 목록 밖의 태그, 속성, 주소는 모두 버린다.
import DOMPurify from 'dompurify';

const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'a', 'img', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'hr', 'span', 'div'];
const ALLOWED_ATTR = ['href', 'src', 'alt', 'colspan', 'rowspan'];

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  // 링크는 새 탭에서, 이 앱의 창을 건드리지 못하게 연다. 그림은 볼 때만 받는다.
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (node.tagName === 'IMG') {
    node.setAttribute('loading', 'lazy');
    node.setAttribute('referrerpolicy', 'no-referrer');
  }
});

export function cleanHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS, ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });
}

// 첨부 형식은 확장자를 글자로 보여 준다(아이콘 대신, docs/DESIGN.md).
export function fileType(name: string, type?: string): string {
  const ext = (type ?? name.split('.').pop() ?? '').replace(/^\./, '').toUpperCase();
  return /^[A-Z0-9]{2,5}$/.test(ext) ? ext : '파일';
}
