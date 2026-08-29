import { Router } from 'express'
import multer from 'multer'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  supabaseAdmin,
  GRANT_DOCUMENTS_BUCKET,
  MAX_FILE_BYTES,
} from '../lib/supabaseAdmin.js'
import { requireAuth } from '../middleware/auth.js'
import { extractObligations } from '../lib/openrouter.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter(_req, file, cb) {
    if (file.mimetype === 'application/pdf') {
      return cb(null, true)
    }
    cb(new Error('Only PDF files are accepted'))
  },
})

const router = Router()

function sanitizeFileName(name) {
  const base = name
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'grant.pdf'
}

async function extractPdfText(buffer) {
  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise
  const numPages = doc.numPages
  const pageTexts = []
  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const strings = content.items.map((item) => item.str)
    pageTexts.push(strings.join(' '))
  }
  return { numPages, text: pageTexts.join('\n\n') }
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
      hint: 'Does the "grant-documents" bucket exist? Run supabase/migrations/20260822010000_storage_bucket.sql',
    })
  }

  let extractionStatus = 'failed'
  let extractionError = null
  let pages = null
  let characters = null
  let preview = ''
  let extractedText = ''

  try {
    const parsed = await extractPdfText(file.buffer)
    extractedText = parsed.text
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
    return res.status(500).json({
      error: `Stored the PDF but could not save the document row: ${documentError.message}`,
      file_path: filePath,
    })
  }

  // Step 2: If text extraction succeeded, run LLM obligation extraction
  let obligations = []
  let obligationError = null

  if (extractionStatus === 'extracted' && extractedText.length > 0) {
    console.log(`[extract] Sending ${extractedText.length} chars to LLM for grant "${name}"`)
    try {
      obligations = await extractObligations(extractedText)
      console.log(`[extract] LLM returned ${obligations.length} obligations`)
    } catch (llmError) {
      console.error('[extract] LLM extraction failed:', llmError.message)
      obligationError = llmError.message
    }

    // Save obligations to DB
    if (obligations.length > 0) {
      const obligationRows = obligations.map((o) => ({
        grant_id: grant.id,
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
        console.error('Failed to insert obligations:', insertError.message)
        obligationError = `Obligations extracted but save failed: ${insertError.message}`
      } else if (inserted) {
        obligations = inserted
      }
    }
  }

  res.status(201).json({
    grant,
    document,
    extraction: { status: extractionStatus, pages, characters, preview, error: extractionError },
    obligations,
    obligationError,
  })
}

router.post('/grants', requireAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: friendlyUploadError(err) })
    }
    createGrant(req, res)
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

  res.json({ obligations })
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
  let extractionStatus = 'failed'
  let pages = null
  let characters = null

  try {
    const parsed = await extractPdfText(buffer)
    extractedText = parsed.text
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

  await supabaseAdmin
    .from('documents')
    .update({ extraction_status: extractionStatus })
    .eq('id', doc.id)

  let obligations = []
  let obligationError = null

  if (extractionStatus === 'extracted' && extractedText.length > 0) {
    console.log(`[retry] Sending ${extractedText.length} chars to LLM for grant "${grantId}"`)
    try {
      obligations = await extractObligations(extractedText)
      console.log(`[retry] LLM returned ${obligations.length} obligations`)
    } catch (llmError) {
      console.error('[retry] LLM extraction failed:', llmError.message)
      obligationError = llmError.message
    }

    if (obligations.length > 0) {
      const obligationRows = obligations.map((o) => ({
        grant_id: grant.id,
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
        console.error('[retry] Failed to insert obligations:', insertError.message)
        obligationError = `Obligations extracted but save failed: ${insertError.message}`
      } else if (inserted) {
        obligations = inserted
      }
    }
  }

  res.json({
    extraction: { status: extractionStatus, pages, characters },
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

export default router
