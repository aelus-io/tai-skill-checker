export function sanitizeRequestUrl(url: string | undefined) {
  if (!url) return undefined
  const path = url.split('?', 1)[0] ?? url
  return path.replace(/(\/api\/invitations\/)[^/]+/u, '$1[REDACTED]')
}
