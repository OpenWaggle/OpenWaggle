export const HOST_RESOLVED_ATTACHMENT = {
  id: 'attachment-host-snapshot',
  kind: 'image',
  origin: 'user-file',
  name: 'evidence.png',
  path: '/path-not-readable-by-the-detached-host/evidence.png',
  mimeType: 'image/png',
  sizeBytes: 4,
  extractedText: '',
  source: { type: 'data', value: 'c25hcA==', mimeType: 'image/png' },
} as const

export const HOST_RESOLVED_PUBLIC_ATTACHMENT = {
  id: HOST_RESOLVED_ATTACHMENT.id,
  kind: HOST_RESOLVED_ATTACHMENT.kind,
  origin: HOST_RESOLVED_ATTACHMENT.origin,
  name: HOST_RESOLVED_ATTACHMENT.name,
  path: HOST_RESOLVED_ATTACHMENT.path,
  mimeType: HOST_RESOLVED_ATTACHMENT.mimeType,
  sizeBytes: HOST_RESOLVED_ATTACHMENT.sizeBytes,
  extractedText: HOST_RESOLVED_ATTACHMENT.extractedText,
} as const
