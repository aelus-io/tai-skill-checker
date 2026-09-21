import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, cosineDistance, eq, sql } from 'drizzle-orm'
import { GoogleGenAI } from '@google/genai'
import { PDFParse } from 'pdf-parse'
import type { AppConfig } from '../../../config/index.js'
import type { Database } from '../../../db/index.js'
import { assessments, resourceChunks, resources } from '../../../db/schema.js'
import { ConfigurationError, NotFoundError } from '../../../http/errors.js'

export function createResourceService(db: Database, config: Pick<AppConfig, 'uploadDir' | 'maxPdfBytes' | 'geminiApiKey' | 'geminiEmbeddingModel'>) {
  async function uploadPdf(input: { organizationId: string; assessmentId: string; userId: string; filename: string; mimeType: string; bytes: Buffer }) {
    const [assessment] = await db.select({ id: assessments.id }).from(assessments).where(and(eq(assessments.id, input.assessmentId), eq(assessments.organizationId, input.organizationId))).limit(1)
    if (!assessment) throw new NotFoundError('Assessment')
    if (input.bytes.length > config.maxPdfBytes) throw new Error('PDF exceeds the configured size limit')
    if (input.mimeType !== 'application/pdf' || input.bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Only valid PDF files are accepted')

    const storageKey = `${input.organizationId}/${input.assessmentId}/${randomUUID()}.pdf`
    const path = join(config.uploadDir, ...storageKey.split('/'))
    await mkdir(join(config.uploadDir, input.organizationId, input.assessmentId), { recursive: true })
    await writeFile(path, input.bytes, { flag: 'wx' })
    let resource: typeof resources.$inferSelect
    try {
      const [inserted] = await db.insert(resources).values({
        organizationId: input.organizationId,
        assessmentId: input.assessmentId,
        uploadedBy: input.userId,
        filename: input.filename,
        mimeType: input.mimeType,
        byteSize: input.bytes.length,
        storageKey,
      }).returning()
      if (!inserted) throw new Error('Resource insert did not return a row')
      resource = inserted
    } catch (error) {
      await rm(path, { force: true })
      throw error
    }
    if (config.geminiApiKey) {
      await processResource({ organizationId: input.organizationId, assessmentId: input.assessmentId, resourceId: resource.id })
      return { ...resource, status: 'READY' as const }
    }
    return resource
  }

  async function processResource(input: { organizationId: string; assessmentId: string; resourceId: string }) {
    if (!config.geminiApiKey) throw new ConfigurationError('Gemini embeddings')
    const [resource] = await db.select().from(resources).where(and(eq(resources.id, input.resourceId), eq(resources.organizationId, input.organizationId), eq(resources.assessmentId, input.assessmentId))).limit(1)
    if (!resource) throw new NotFoundError('Resource')
    await db.update(resources).set({ status: 'PROCESSING', updatedAt: new Date() }).where(eq(resources.id, resource.id))
    try {
      const parser = new PDFParse({ data: await readFile(join(config.uploadDir, ...resource.storageKey.split('/'))) })
      const result = await parser.getText().finally(() => parser.destroy())
      const chunks = chunkText(result.text)
      if (!chunks.length) throw new Error('PDF contains no extractable text')
      const ai = new GoogleGenAI({ apiKey: config.geminiApiKey })
      const embedded = await ai.models.embedContent({ model: config.geminiEmbeddingModel, contents: chunks, config: { outputDimensionality: 768, taskType: 'RETRIEVAL_DOCUMENT' } })
      const rows = chunks.map((content, position) => {
        const embedding = embedded.embeddings?.[position]?.values
        if (!embedding || embedding.length !== 768) throw new Error('Embedding provider returned an invalid vector')
        return { organizationId: input.organizationId, assessmentId: input.assessmentId, assessmentVersionId: resource.assessmentVersionId, resourceId: resource.id, position: position + 1, content, embedding }
      })
      await db.transaction(async (tx) => { await tx.delete(resourceChunks).where(eq(resourceChunks.resourceId, resource.id)); await tx.insert(resourceChunks).values(rows); await tx.update(resources).set({ status: 'READY', updatedAt: new Date() }).where(eq(resources.id, resource.id)) })
      return { chunks: rows.length }
    } catch (error) {
      await db.update(resources).set({ status: 'FAILED', updatedAt: new Date() }).where(eq(resources.id, resource.id))
      throw error
    }
  }

  async function retrieve(input: { organizationId: string; assessmentId: string; assessmentVersionId: string; query: string; limit?: number }) {
    if (!config.geminiApiKey) throw new ConfigurationError('Gemini embeddings')
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey })
    const result = await ai.models.embedContent({ model: config.geminiEmbeddingModel, contents: input.query, config: { outputDimensionality: 768, taskType: 'RETRIEVAL_QUERY' } })
    const embedding = result.embeddings?.[0]?.values
    if (!embedding || embedding.length !== 768) throw new Error('Embedding provider returned an invalid vector')
    const distance = cosineDistance(resourceChunks.embedding, embedding)
    return db.select({ resourceId: resourceChunks.resourceId, position: resourceChunks.position, content: resourceChunks.content, similarity: sql<number>`1 - (${distance})` }).from(resourceChunks).where(and(eq(resourceChunks.organizationId, input.organizationId), eq(resourceChunks.assessmentId, input.assessmentId), eq(resourceChunks.assessmentVersionId, input.assessmentVersionId))).orderBy(distance).limit(Math.min(input.limit ?? 5, 10))
  }

  return { uploadPdf, processResource, retrieve }
}

function chunkText(text: string, size = 1_200, overlap = 200) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const chunks: string[] = []
  let start = 0
  while (start < normalized.length) {
    const raw = normalized.slice(start, start + size)
    const boundary = raw.length === size ? Math.max(raw.lastIndexOf('. '), raw.lastIndexOf(' ')) : raw.length
    const end = boundary > size / 2 ? boundary + (raw[boundary] === '.' ? 1 : 0) : raw.length
    chunks.push(raw.slice(0, end).trim())
    if (start + size >= normalized.length) break
    start += Math.max(1, end - overlap)
  }
  return chunks.filter(Boolean)
}
