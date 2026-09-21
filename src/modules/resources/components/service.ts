import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import type { AppConfig } from '../../../config/index.js'
import type { Database } from '../../../db/index.js'
import { assessments, resources } from '../../../db/schema.js'
import { NotFoundError } from '../../../http/errors.js'

export function createResourceService(db: Database, config: Pick<AppConfig, 'uploadDir' | 'maxPdfBytes'>) {
  async function uploadPdf(input: { organizationId: string; assessmentId: string; userId: string; filename: string; mimeType: string; bytes: Buffer }) {
    const [assessment] = await db.select({ id: assessments.id }).from(assessments).where(and(eq(assessments.id, input.assessmentId), eq(assessments.organizationId, input.organizationId))).limit(1)
    if (!assessment) throw new NotFoundError('Assessment')
    if (input.bytes.length > config.maxPdfBytes) throw new Error('PDF exceeds the configured size limit')
    if (input.mimeType !== 'application/pdf' || input.bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Only valid PDF files are accepted')

    const storageKey = `${input.organizationId}/${input.assessmentId}/${randomUUID()}.pdf`
    const path = join(config.uploadDir, ...storageKey.split('/'))
    await mkdir(join(config.uploadDir, input.organizationId, input.assessmentId), { recursive: true })
    await writeFile(path, input.bytes, { flag: 'wx' })
    try {
      const [resource] = await db.insert(resources).values({
        organizationId: input.organizationId,
        assessmentId: input.assessmentId,
        uploadedBy: input.userId,
        filename: input.filename,
        mimeType: input.mimeType,
        byteSize: input.bytes.length,
        storageKey,
      }).returning()
      if (!resource) throw new Error('Resource insert did not return a row')
      return resource
    } catch (error) {
      await rm(path, { force: true })
      throw error
    }
  }

  return { uploadPdf }
}
