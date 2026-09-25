import { describe, expect, it } from 'vitest'
import { coverImageUrl, detectCoverImageType } from '../index.js'

describe('cover images', () => {
  it('detects supported image types from their signature', () => {
    expect(detectCoverImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))?.mimeType).toBe('image/png')
    expect(detectCoverImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mimeType).toBe('image/jpeg')
    expect(detectCoverImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))?.mimeType).toBe('image/webp')
  })

  it('rejects files that are not raster images', () => {
    expect(detectCoverImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
    expect(detectCoverImageType(Buffer.from('%PDF-1.7'))).toBeNull()
  })

  it('versions cover URLs by storage key', () => {
    expect(coverImageUrl('/api/assessments/a1/cover', 'org/a1/covers/abc-123.png')).toBe('/api/assessments/a1/cover?v=abc-123')
    expect(coverImageUrl('/api/assessments/a1/cover', null)).toBeNull()
  })
})
