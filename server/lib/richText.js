export function sanitizeRichText(input) {
  return String(input || '')
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/\s(href|src)\s*=\s*(["'])(?!(?:https?:\/\/|\/api\/rich-attachments\/public\/|\/uploads\/))[^"']*\2/gi, '')
    .replace(/<(?!\/?(?:b|strong|i|em|u|p|br|ul|ol|li|a|img|blockquote|h[1-3])\b)[^>]*>/gi, '');
}
