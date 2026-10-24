import { randomBytes } from 'node:crypto'
import { safeRouter } from '../lib/safeRouter.js'
import multer from 'multer'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  supabaseAdmin,
  GRANT_DOCUMENTS_BUCKET,
  MAX_FILE_BYTES,
} from '../lib/supabaseAdmin.js'
import { requireAuth } from '../middleware/auth.js'
import { buildPagedText, extractObligations } from '../lib/groq.js'
import { findDocumentHints } from '../lib/documentHints.js'
import { fillMissingDueDates } from '../lib/dates.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter(_req, file, cb) {
    // Some browsers send dragged-in PDFs as application/octet-stream
    if (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '')) {
      return cb(null, true)
    }
    cb(new Error('Only PDF files are accepted'))
  },
})

const router = safeRouter()

function sanitizeFileName(name) {
  const base = name
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'grant.pdf'
}

async function extractPdfText(buffer, { maxPages = Infinity } = {}) {
  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise
  const numPages = doc.numPages
  const pageTexts = []
  for (let i = 1; i <= Math.min(numPages, maxPages); i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const strings = content.items.map((item) => item.str)
    pageTexts.push(strings.join(' '))
  }
  return { numPages, pageTexts, text: pageTexts.join('\n\n') }
}

// Stores the agreement's own reference number. Non-fatal, so uploads keep
// working on databases that haven't run migrations/006_grant_number.sql.
async function saveGrantNumber(grantId, grantNumber) {
  if (!grantNumber) return null
  const { error } = await supabaseAdmin.from('grants').update({ grant_number: grantNumber }).eq('id', grantId)
  if (error) {
    console.warn(`[grant_number] Not saved (run migrations/006_grant_number.sql?): ${error.message}`)
    return null
  }
  return grantNumber
}

// Runs the LLM over the page texts, saves the obligations, and records the
// outcome on the document row: "extracted" on success, "failed" when the AI
// call or the save fails or nothing was found (so the dashboard offers Retry).
// With replaceExisting, the grant's previous obligations are removed only
// after the new ones are saved, so a failed retry never loses data.
// The grant number is taken from the AI, then the form's hint, then a
// pattern match on the first pages.
async function runObligationExtraction({
  grantId,
  documentId,
  pageTexts,
  pages,
  label,
  replaceExisting = false,
  fallbackGrantNumber = null,
}) {
  const paged = buildPagedText(pageTexts)
  let obligations = []
  let obligationError = null
  let details = { grantNumber: null, funderName: null }

  console.log(
    `[${label}] Sending ${paged.text.length} chars (${paged.pagesIncluded}/${pages} pages) to LLM for grant "${grantId}"`,
  )
  try {
    const result = await extractObligations(paged.text, { pageCount: pages })
    obligations = result.obligations
    details = { grantNumber: result.grantNumber, funderName: result.funderName }
    console.log(`[${label}] LLM returned ${obligations.length} obligations (grant number: ${details.grantNumber || 'none'})`)
  } catch (llmError) {
    console.error(`[${label}] LLM extraction failed:`, llmError.message)
    obligationError = `AI extraction failed: ${llmError.message}`
  }

  if (!obligationError && obligations.length === 0) {
    obligationError = 'The AI found no obligations in this document.'
  }

  if (!obligationError) {
    let previousIds = []
    if (replaceExisting) {
      const { data: previous } = await supabaseAdmin
        .from('obligations')
        .select('id')
        .eq('grant_id', grantId)
      previousIds = (previous || []).map((o) => o.id)
    }

    const obligationRows = obligations.map((o) => ({
      grant_id: grantId,
      type: o.type,
      description: o.description,
      due_date: o.due_date || null,
      source_page: o.source_page,
      source_excerpt: o.source_excerpt,
      confidence: o.confidence,
      status: 'pending_review',
    }))

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('obligations')
      .insert(obligationRows)
      .select()

    if (insertError) {
      console.error(`[${label}] Failed to insert obligations:`, insertError.message)
      obligationError = `Obligations extracted but save failed: ${insertError.message}`
      obligations = []
    } else {
      obligations = inserted || []
      if (previousIds.length > 0) {
        await supabaseAdmin.from('obligations').delete().in('id', previousIds)
      }
    }
  }

  const documentStatus = obligationError ? 'failed' : 'extracted'
  await supabaseAdmin.from('documents').update({ extraction_status: documentStatus }).eq('id', documentId)

  const grantNumber = await saveGrantNumber(
    grantId,
    details.grantNumber || fallbackGrantNumber || findDocumentHints(pageTexts.slice(0, 2).join(' ')).grant_number,
  )

  return {
    obligations,
    obligationError,
    truncated: paged.truncated,
    documentStatus,
    grantNumber,
    funderName: details.funderName,
  }
}

function friendlyUploadError(err) {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return 'File is too large (max 15 MB)'
  }
  return err.message || 'Upload failed'
}

async function createGrant(req, res) {
  const name = (req.body.name || '').trim()
  const funderName = (req.body.funder_name || '').trim()
  const file = req.file

  if (!name || !funderName) {
    return res.status(400).json({ error: 'name and funder_name are required' })
  }
  if (!file) {
    return res.status(400).json({ error: 'file is required' })
  }

  const userId = req.user.id

  const { data: grant, error: grantError } = await supabaseAdmin
    .from('grants')
    .insert({ user_id: userId, name, funder_name: funderName })
    .select()
    .single()

  if (grantError) {
    return res.status(500).json({ error: `Could not create grant: ${grantError.message}` })
  }

  const filePath = `${userId}/${grant.id}/${Date.now()}-${sanitizeFileName(file.originalname)}`

  const { error: storageError } = await supabaseAdmin.storage
    .from(GRANT_DOCUMENTS_BUCKET)
    .upload(filePath, file.buffer, { contentType: 'application/pdf' })

  if (storageError) {
    await supabaseAdmin.from('grants').delete().eq('id', grant.id)
    return res.status(502).json({
      error: `Could not store the PDF: ${storageError.message}`,
      hint: 'Does the "grant-documents" bucket exist? Run migrations/002_storage_bucket.sql',
    })
  }

  let extractionStatus = 'failed'
  let extractionError = null
  let pages = null
  let characters = null
  let preview = ''
  let extractedText = ''
  let pageTexts = []

  try {
    const parsed = await extractPdfText(file.buffer)
    extractedText = parsed.text
    pageTexts = parsed.pageTexts
    pages = parsed.numPages
    characters = parsed.text.length
    preview = parsed.text.replace(/\s+/g, ' ').trim().slice(0, 500)

    const trimmedText = extractedText.replace(/\s+/g, '').trim()
    if (trimmedText.length < 50) {
      await supabaseAdmin.storage
        .from(GRANT_DOCUMENTS_BUCKET)
        .remove([filePath])
      await supabaseAdmin.from('grants').delete().eq('id', grant.id)
      return res.status(422).json({
        error: 'PDF contains too little extractable text (possible scanned/image PDF)',
        hint: 'Please upload a text-based PDF. Scanned documents cannot be processed.',
        characters: trimmedText.length,
      })
    }

    extractionStatus = 'extracted'
  } catch (parseError) {
    console.error('PDF extraction failed:', parseError.message)
    extractionError =
      parseError && parseError.message
        ? String(parseError.message)
        : 'Unknown PDF parsing error'
  }

  const { data: document, error: documentError } = await supabaseAdmin
    .from('documents')
    .insert({
      grant_id: grant.id,
      file_path: filePath,
      extraction_status: extractionStatus,
    })
    .select()
    .single()

  if (documentError) {
    // Without a document row the grant would sit in "processing" forever
    await supabaseAdmin.storage.from(GRANT_DOCUMENTS_BUCKET).remove([filePath])
    await supabaseAdmin.from('grants').delete().eq('id', grant.id)
    return res.status(500).json({
      error: `Could not save the document record: ${documentError.message}`,
    })
  }

  // Step 2: If text extraction succeeded, run LLM obligation extraction
  let obligations = []
  let obligationError = null
  let truncated = false
  let detectedFunder = null

  if (extractionStatus === 'extracted' && extractedText.length > 0) {
    const result = await runObligationExtraction({
      grantId: grant.id,
      documentId: document.id,
      pageTexts,
      pages,
      label: 'extract',
      fallbackGrantNumber: (req.body.grant_number || '').trim().slice(0, 60) || null,
    })
    obligations = result.obligations
    obligationError = result.obligationError
    truncated = result.truncated
    document.extraction_status = result.documentStatus
    if (result.grantNumber) grant.grant_number = result.grantNumber
    detectedFunder = result.funderName
  }

  res.status(201).json({
    grant,
    document,
    extraction: {
      status: extractionStatus,
      pages,
      characters,
      preview,
      truncated,
      error: extractionError,
      grant_number: grant.grant_number || null,
      funder_name: detectedFunder,
    },
    obligations,
    obligationError,
  })
}

router.post('/grants', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: friendlyUploadError(err) })
    }
    createGrant(req, res).catch(next)
  })
})

// ── Pre-fill hints for the upload form (nothing is stored) ──────────
// Reads the first pages' text and pattern-matches the funder and the
// grant/reference number. No AI call, so it's fast and costs no tokens.
router.post('/grants/preview', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: friendlyUploadError(err) })
    }
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' })
    }
    try {
      const { pageTexts } = await extractPdfText(req.file.buffer, { maxPages: 2 })
      res.json(findDocumentHints(pageTexts.join('\n')))
    } catch (parseError) {
      // An unreadable PDF just means no hints; the real upload reports it
      console.warn('[preview] Could not read PDF:', parseError.message)
      res.json({ grant_number: null, funder_name: null })
    }
  })
})

// ── List obligations for a grant ─────────────────────────────────
router.get('/grants/:id/obligations', requireAuth, async (req, res) => {
  const userId = req.user.id
  const grantId = req.params.id

  const { data: grant, error: grantErr } = await supabaseAdmin
    .from('grants')
    .select('id')
    .eq('id', grantId)
    .eq('user_id', userId)
    .single()

  if (grantErr || !grant) {
    return res.status(404).json({ error: 'Grant not found' })
  }

  const { data: obligations, error } = await supabaseAdmin
    .from('obligations')
    .select('*')
    .eq('grant_id', grantId)
    .order('created_at', { ascending: true })

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  // Obligations extracted before the date fallback existed: take the date
  // from the quoted clause and save it, so calendars and chat see it too
  const { rows, filled } = fillMissingDueDates(obligations)
  for (const o of filled) {
    const { error: fillError } = await supabaseAdmin
      .from('obligations')
      .update({ due_date: o.due_date })
      .eq('id', o.id)
      .is('due_date', null)
    if (fillError) console.warn(`[due_date] Could not save ${o.id}: ${fillError.message}`)
  }
  if (filled.length > 0) console.log(`[due_date] Filled ${filled.length} missing due date(s) for grant "${grantId}"`)

  res.json({ obligations: rows })
})

// ── Update a single obligation (inline edit) ─────────────────────
router.patch('/grants/:id/obligations/:obligationId', requireAuth, async (req, res) => {
  const userId = req.user.id
  const grantId = req.params.id
  const obligationId = req.params.obligationId

  const { data: grant, error: grantErr } = await supabaseAdmin
    .from('grants')
    .select('id')
    .eq('id', grantId)
    .eq('user_id', userId)
    .single()

  if (grantErr || !grant) {
    return res.status(404).json({ error: 'Grant not found' })
  }

  const allowed = ['description', 'due_date', 'type', 'verified']
  const updates = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key]
    }
  }
  // "Done" is separate from "confirmed": confirming checks the AI's
  // extraction, completing records that the obligation was fulfilled.
  // Marking it done also approves it; undoing done leaves it approved.
  if (req.body.completed !== undefined) {
    updates.completed_at = req.body.completed ? new Date().toISOString() : null
    if (req.body.completed) updates.status = 'confirmed'
  }

  // Approve (or un-approve) a single extraction
  if (req.body.status !== undefined && !req.body.completed) {
    if (!['pending_review', 'confirmed'].includes(req.body.status)) {
      return res.status(400).json({ error: 'Invalid status' })
    }
    updates.status = req.body.status
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' })
  }

  if (updates.type && !['deadline', 'reporting', 'eligible_activity', 'compliance_condition'].includes(updates.type)) {
    return res.status(400).json({ error: 'Invalid obligation type' })
  }

  const { data: updated, error } = await supabaseAdmin
    .from('obligations')
    .update(updates)
    .eq('id', obligationId)
    .eq('grant_id', grantId)
    .select()
    .single()

  if (error) {
    if (/completed_at/.test(error.message)) {
      return res.status(500).json({
        error: 'Marking obligations as done needs a database update: run migrations/005_obligation_completed.sql.',
      })
    }
    return res.status(500).json({ error: error.message })
  }

  res.json({ obligation: updated })
})

// ── Delete a grant and its documents/obligations ──────────────────
router.delete('/grants/:id', requireAuth, async (req, res) => {
  const userId = req.user.id
  const grantId = req.params.id

  const { data: grant, error: grantErr } = await supabaseAdmin
    .from('grants')
    .select('id')
    .eq('id', grantId)
    .eq('user_id', userId)
    .single()

  if (grantErr || !grant) {
    return res.status(404).json({ error: 'Grant not found' })
  }

  await supabaseAdmin.from('obligations').delete().eq('grant_id', grantId)
  await supabaseAdmin.from('documents').delete().eq('grant_id', grantId)

  const { data: docs } = await supabaseAdmin
    .from('documents')
    .select('file_path')
    .eq('grant_id', grantId)

  if (docs && docs.length > 0) {
    const paths = docs.map((d) => d.file_path)
    await supabaseAdmin.storage.from(GRANT_DOCUMENTS_BUCKET).remove(paths)
  }

  await supabaseAdmin.from('grants').delete().eq('id', grantId)

  res.json({ deleted: true })
})

// ── Retry extraction for a failed grant ──────────────────────────
router.post('/grants/:id/retry', requireAuth, async (req, res) => {
  const userId = req.user.id
  const grantId = req.params.id

  const { data: grant, error: grantErr } = await supabaseAdmin
    .from('grants')
    .select('id')
    .eq('id', grantId)
    .eq('user_id', userId)
    .single()

  if (grantErr || !grant) {
    return res.status(404).json({ error: 'Grant not found' })
  }

  const { data: docs } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('grant_id', grantId)
    .order('uploaded_at', { ascending: false })
    .limit(1)

  if (!docs || docs.length === 0) {
    return res.status(404).json({ error: 'No document found for this grant' })
  }

  const doc = docs[0]

  const { data: fileData, error: downloadErr } = await supabaseAdmin.storage
    .from(GRANT_DOCUMENTS_BUCKET)
    .download(doc.file_path)

  if (downloadErr) {
    return res.status(500).json({ error: `Could not download PDF: ${downloadErr.message}` })
  }

  const buffer = Buffer.from(await fileData.arrayBuffer())
  let extractedText = ''
  let pageTexts = []
  let extractionStatus = 'failed'
  let pages = null
  let characters = null

  try {
    const parsed = await extractPdfText(buffer)
    extractedText = parsed.text
    pageTexts = parsed.pageTexts
    pages = parsed.numPages
    characters = parsed.text.length
    const trimmedText = extractedText.replace(/\s+/g, '').trim()
    if (trimmedText.length < 50) {
      return res.status(422).json({ error: 'PDF contains too little extractable text (possible scanned/image PDF)', characters: trimmedText.length })
    }
    extractionStatus = 'extracted'
  } catch (parseError) {
    console.error('[retry] PDF extraction failed:', parseError.message)
    return res.status(500).json({ error: `PDF parsing failed: ${parseError.message}` })
  }

  const { obligations, obligationError, truncated, grantNumber } = await runObligationExtraction({
    grantId: grant.id,
    documentId: doc.id,
    pageTexts,
    pages,
    label: 'retry',
    replaceExisting: true,
  })

  res.json({
    extraction: { status: extractionStatus, pages, characters, truncated, grant_number: grantNumber },
    obligations,
    obligationError,
  })
})

// ── Confirm all pending_review obligations for a grant ────────────
router.post('/grants/:id/obligations/confirm', requireAuth, async (req, res) => {
  const userId = req.user.id
  const grantId = req.params.id

  const { data: grant, error: grantErr } = await supabaseAdmin
    .from('grants')
    .select('id')
    .eq('id', grantId)
    .eq('user_id', userId)
    .single()

  if (grantErr || !grant) {
    return res.status(404).json({ error: 'Grant not found' })
  }

  const { data: updated, error, count } = await supabaseAdmin
    .from('obligations')
    .update({ status: 'confirmed' })
    .eq('grant_id', grantId)
    .eq('status', 'pending_review')
    .select()

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.json({
    confirmed: updated.length,
    obligations: updated,
  })
})

// ── Stream the uploaded document PDF for a grant ─────────────────
router.get('/grants/:id/document', requireAuth, async (req, res) => {
  const userId = req.user.id
  const grantId = req.params.id

  const { data: grant, error: grantErr } = await supabaseAdmin
    .from('grants')
    .select('id, name')
    .eq('id', grantId)
    .eq('user_id', userId)
    .single()

  if (grantErr || !grant) {
    return res.status(404).json({ error: 'Grant not found' })
  }

  const { data: docs } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('grant_id', grantId)
    .order('uploaded_at', { ascending: false })
    .limit(1)

  if (!docs || docs.length === 0) {
    return res.status(404).json({ error: 'No document uploaded for this grant' })
  }

  const doc = docs[0]

  const { data: fileData, error: downloadErr } = await supabaseAdmin.storage
    .from(GRANT_DOCUMENTS_BUCKET)
    .download(doc.file_path)

  if (downloadErr || !fileData) {
    console.error('[document] Download failed:', downloadErr?.message)
    return res.status(500).json({ error: 'Could not load the document from storage' })
  }

  const buffer = Buffer.from(await fileData.arrayBuffer())
  const fileName = doc.file_path.split('/').pop() || 'document.pdf'

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Length', buffer.length)
  res.setHeader('Content-Disposition', `inline; filename="${fileName}"`)
  res.setHeader('Cache-Control', 'private, max-age=60')
  res.send(buffer)
})

// ── Generate / regenerate a public read-only share token for a grant ─
router.post('/grants/:id/share', requireAuth, async (req, res) => {
  const userId = req.user.id
  const grantId = req.params.id

  const { data: grant, error: grantErr } = await supabaseAdmin
    .from('grants')
    .select('id')
    .eq('id', grantId)
    .eq('user_id', userId)
    .single()

  if (grantErr || !grant) {
    return res.status(404).json({ error: 'Grant not found' })
  }

  const token = randomBytes(24).toString('base64url')

  const { data: updated, error } = await supabaseAdmin
    .from('grants')
    .update({ share_token: token })
    .eq('id', grantId)
    .eq('user_id', userId)
    .select('share_token')
    .single()

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.json({ share_token: updated.share_token })
})

// ── Revoke a grant's share token (invalidates the public link) ─────
router.post('/grants/:id/share/revoke', requireAuth, async (req, res) => {
  const userId = req.user.id
  const grantId = req.params.id

  const { data: grant, error: grantErr } = await supabaseAdmin
    .from('grants')
    .select('id')
    .eq('id', grantId)
    .eq('user_id', userId)
    .single()

  if (grantErr || !grant) {
    return res.status(404).json({ error: 'Grant not found' })
  }

  const { error } = await supabaseAdmin
    .from('grants')
    .update({ share_token: null })
    .eq('id', grantId)
    .eq('user_id', userId)

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.json({ revoked: true })
})

// ── Fetch current share token for a grant (owner only) ────────────
router.get('/grants/:id/share', requireAuth, async (req, res) => {
  const userId = req.user.id
  const grantId = req.params.id

  const { data: grant, error: grantErr } = await supabaseAdmin
    .from('grants')
    .select('share_token')
    .eq('id', grantId)
    .eq('user_id', userId)
    .single()

  if (grantErr || !grant) {
    return res.status(404).json({ error: 'Grant not found' })
  }

  res.json({ share_token: grant.share_token })
})

export default router
