import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { apiFetch, readJson, uploadWithProgress } from '../lib/api'

const MAX_FILE_BYTES = 15 * 1024 * 1024

const STEPS = [
  { key: 'uploading', label: 'Uploading' },
  { key: 'reading', label: 'Reading document' },
  { key: 'extracting', label: 'Extracting obligations' },
  { key: 'done', label: 'Done' },
]

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function validateFile(file) {
  if (!file) return 'Choose the agreement PDF.'
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (!isPdf) return 'Only PDF files can be analyzed.'
  if (file.size > MAX_FILE_BYTES) return `This file is ${formatSize(file.size)}. The maximum is 15 MB.`
  if (file.size === 0) return 'This file is empty.'
  return null
}

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${data.session?.access_token}` }
}

const inputClass =
  'bg-transparent border-0 border-b hover:border-primary focus:border-primary focus:outline-none px-0 py-2 font-source-code text-source-code text-on-surface placeholder:text-on-surface-variant/60 transition-colors'

export default function UploadModal({ open, onClose, onUploaded }) {
  const navigate = useNavigate()
  const fileInputRef = useRef(null)

  const [name, setName] = useState('')
  const [funder, setFunder] = useState('')
  const [file, setFile] = useState(null)
  const [fileError, setFileError] = useState(null)
  const [touched, setTouched] = useState({})
  const [dragOver, setDragOver] = useState(false)
  const [hints, setHints] = useState(null)

  // form | uploading | reading | extracting | done | error
  const [phase, setPhase] = useState('form')
  const [progress, setProgress] = useState(0)
  const [failure, setFailure] = useState(null)

  if (!open) return null

  const busy = ['uploading', 'reading', 'extracting', 'done'].includes(phase)
  const errors = {
    name: name.trim() ? null : 'Enter the grant name.',
    funder: funder.trim() ? null : 'Enter the funder.',
    file: fileError || (file ? null : 'Choose the agreement PDF.'),
  }
  const canSubmit = !errors.name && !errors.funder && !errors.file

  function reset() {
    setName('')
    setFunder('')
    setFile(null)
    setFileError(null)
    setTouched({})
    setHints(null)
    setPhase('form')
    setProgress(0)
    setFailure(null)
  }

  function close() {
    if (busy) return
    reset()
    onClose()
  }

  async function selectFile(candidate) {
    setTouched((t) => ({ ...t, file: true }))
    const problem = validateFile(candidate)
    setFileError(problem)
    setHints(null)
    if (problem) {
      setFile(null)
      return
    }
    setFile(candidate)

    // Pre-fill from the document (pattern match only, nothing is stored)
    try {
      const body = new FormData()
      body.append('file', candidate)
      const res = await apiFetch('/api/grants/preview', { method: 'POST', headers: await authHeader(), body })
      const found = await readJson(res)
      if (!res.ok) return
      setHints(found)
      if (found.funder_name) setFunder((current) => current || found.funder_name)
    } catch {
      // Hints are optional; the form works without them
    }
  }

  function removeFile() {
    setFile(null)
    setFileError(null)
    setHints(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function finish(grant, count, truncated) {
    setPhase('done')
    setProgress(1)
    onUploaded?.()
    toast.success(`${count} obligation${count === 1 ? '' : 's'} extracted from ${grant.name}`)
    if (truncated) {
      toast('This is a long document, so only its first pages were analyzed.', { icon: 'ℹ️', duration: 6000 })
    }
    setTimeout(() => {
      reset()
      onClose()
      navigate(`/grants/${grant.id}/review`, { state: { grantName: grant.name } })
    }, 600)
  }

  async function runUpload() {
    setFailure(null)
    setPhase('uploading')
    setProgress(0)

    const body = new FormData()
    body.append('name', name.trim())
    body.append('funder_name', funder.trim())
    if (hints?.grant_number) body.append('grant_number', hints.grant_number)
    body.append('file', file)

    let extractingTimer
    try {
      const { ok, payload } = await uploadWithProgress('/api/grants', {
        body,
        headers: await authHeader(),
        onUploadProgress: setProgress,
        // The server reads the PDF (fast), then waits on the AI (slow)
        onUploaded: () => {
          setPhase('reading')
          extractingTimer = setTimeout(() => setPhase('extracting'), 1200)
        },
      })
      clearTimeout(extractingTimer)

      if (!ok) throw new Error(payload.error || 'Upload failed.')

      if (payload.extraction?.status !== 'extracted' || payload.obligationError) {
        // The grant was saved; Retry re-runs extraction on it (no duplicate)
        onUploaded?.()
        setFailure({
          message:
            payload.extraction?.status !== 'extracted'
              ? 'The PDF text could not be read. It may be a scanned/image PDF.'
              : payload.obligationError,
          grant: payload.grant,
        })
        setPhase('error')
        return
      }

      finish(payload.grant, payload.obligations?.length || 0, payload.extraction?.truncated)
    } catch (err) {
      clearTimeout(extractingTimer)
      setFailure({ message: err.message || 'Upload failed.', grant: null })
      setPhase('error')
    }
  }

  async function retry() {
    if (!failure?.grant) {
      runUpload()
      return
    }
    const { grant } = failure
    setFailure(null)
    setPhase('extracting')
    try {
      const res = await apiFetch(`/api/grants/${grant.id}/retry`, { method: 'POST', headers: await authHeader() })
      const payload = await readJson(res)
      if (!res.ok) throw new Error(payload.error || 'Retry failed.')
      if (payload.obligationError) throw new Error(payload.obligationError)
      finish(grant, payload.obligations?.length || 0, payload.extraction?.truncated)
    } catch (err) {
      setFailure({ message: err.message || 'Retry failed.', grant })
      setPhase('error')
    }
  }

  function handleSubmit(event) {
    event.preventDefault()
    setTouched({ name: true, funder: true, file: true })
    if (!canSubmit || busy) return
    runUpload()
  }

  const showError = (field) => touched[field] && errors[field]
  const stepIndex = STEPS.findIndex((s) => s.key === phase)
  const barPercent =
    phase === 'uploading' ? 5 + progress * 25 : phase === 'reading' ? 40 : phase === 'extracting' ? 70 : phase === 'done' ? 100 : 0

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 md:p-8 overflow-y-auto">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-title"
        className="relative w-full max-w-2xl bg-surface-container-lowest inkwell-border notched-card shadow-2xl mt-10 md:mt-16"
      >
        <div className="absolute inset-0 pointer-events-none opacity-5 blueprint-grid text-primary" />
        <div className="relative p-6 md:p-8">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined filled-icon text-primary">upload_file</span>
                <h3 id="upload-title" className="font-headline-lg-mobile text-headline-lg-mobile font-semibold text-on-surface">
                  New Grant Agreement
                </h3>
              </div>
              <p className="text-body-sm text-secondary">
                Upload a PDF agreement and GrantGuard will extract its compliance obligations.
              </p>
            </div>
            <button
              onClick={close}
              disabled={busy}
              aria-label="Close upload"
              className="text-secondary hover:text-primary transition-colors p-1 disabled:opacity-40"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {phase === 'form' ? (
            <form onSubmit={handleSubmit} noValidate className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="flex flex-col gap-1">
                <label htmlFor="upload-name" className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                  Grant Name <span className="text-alert-crimson" aria-hidden="true">*</span>
                </label>
                <input
                  id="upload-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  aria-invalid={Boolean(showError('name'))}
                  aria-describedby={showError('name') ? 'upload-name-error' : undefined}
                  placeholder="e.g. WASH Access Programme 2026"
                  className={`${inputClass} ${showError('name') ? 'border-alert-crimson' : 'border-outline'}`}
                />
                {showError('name') && (
                  <p id="upload-name-error" className="text-body-sm text-alert-crimson">{errors.name}</p>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="upload-funder" className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                  Funder <span className="text-alert-crimson" aria-hidden="true">*</span>
                </label>
                <input
                  id="upload-funder"
                  type="text"
                  required
                  value={funder}
                  onChange={(e) => setFunder(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, funder: true }))}
                  aria-invalid={Boolean(showError('funder'))}
                  aria-describedby={showError('funder') ? 'upload-funder-error' : undefined}
                  placeholder="e.g. GlobalDev Foundation"
                  className={`${inputClass} ${showError('funder') ? 'border-alert-crimson' : 'border-outline'}`}
                />
                {showError('funder') && (
                  <p id="upload-funder-error" className="text-body-sm text-alert-crimson">{errors.funder}</p>
                )}
              </div>

              <div className="md:col-span-2 flex flex-col gap-1">
                <span id="upload-file-label" className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                  Agreement PDF <span className="text-alert-crimson" aria-hidden="true">*</span>
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && selectFile(e.target.files[0])}
                />
                {file ? (
                  <div className="flex items-center gap-3 inkwell-border bg-surface-container-low px-4 py-3">
                    <span className="material-symbols-outlined text-primary text-[28px]">picture_as_pdf</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-body-md text-on-surface truncate">{file.name}</p>
                      <p className="font-source-code text-source-code text-on-surface-variant">{formatSize(file.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={removeFile}
                      aria-label={`Remove ${file.name}`}
                      className="p-1 text-secondary hover:text-alert-crimson transition-colors"
                    >
                      <span className="material-symbols-outlined">close</span>
                    </button>
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    aria-labelledby="upload-file-label"
                    aria-describedby={showError('file') ? 'upload-file-error' : 'upload-file-help'}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        fileInputRef.current?.click()
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setDragOver(true)
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragOver(false)
                      const dropped = e.dataTransfer.files?.[0]
                      if (dropped) selectFile(dropped)
                    }}
                    className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors ${
                      dragOver
                        ? 'border-primary bg-primary-container/30'
                        : showError('file')
                          ? 'border-alert-crimson bg-surface'
                          : 'border-outline bg-surface hover:border-primary hover:bg-surface-container-low'
                    }`}
                  >
                    <span className="material-symbols-outlined text-primary text-[36px]">cloud_upload</span>
                    <p className="text-body-md text-on-surface">
                      Drop your grant PDF here or <span className="text-primary font-medium underline">click to browse</span>
                    </p>
                    <p id="upload-file-help" className="font-source-code text-source-code text-on-surface-variant">
                      PDF only · max 15 MB
                    </p>
                  </div>
                )}
                {showError('file') && (
                  <p id="upload-file-error" className="text-body-sm text-alert-crimson">{errors.file}</p>
                )}
                {hints && (hints.grant_number || hints.funder_name) && (
                  <p className="flex items-center gap-1.5 text-body-sm text-secondary">
                    <span className="material-symbols-outlined text-[16px] text-primary">auto_awesome</span>
                    Found in the document:
                    {hints.grant_number && <span className="font-source-code text-on-surface">{hints.grant_number}</span>}
                    {hints.grant_number && hints.funder_name && '·'}
                    {hints.funder_name && <span className="text-on-surface">{hints.funder_name}</span>}
                  </p>
                )}
              </div>

              <div className="md:col-span-2 flex flex-wrap items-center justify-end gap-3 pt-2">
                {!canSubmit && (
                  <p className="mr-auto text-body-sm text-secondary">
                    Fill in the required fields (<span className="text-alert-crimson">*</span>) to analyze.
                  </p>
                )}
                <button
                  type="button"
                  onClick={close}
                  className="py-3 px-4 border border-outline text-primary font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-container transition-colors notched-br"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="bg-primary text-on-primary py-3 px-5 font-label-caps text-label-caps tracking-wider flex items-center justify-center gap-2 hover:bg-surface-tint transition-colors notched-br disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="material-symbols-outlined filled-icon text-[16px]">auto_awesome</span>
                  ANALYZE
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-6" aria-live="polite">
              <div>
                <p className="text-body-md text-on-surface mb-1 truncate">
                  <span className="font-medium">{name}</span>
                  <span className="text-secondary"> · {file?.name}</span>
                </p>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(barPercent)}
                  className="h-2 bg-surface-container-high overflow-hidden"
                >
                  <div
                    className={`h-full transition-all duration-500 ${phase === 'error' ? 'bg-alert-crimson' : 'bg-primary'} ${
                      phase === 'extracting' ? 'animate-pulse' : ''
                    }`}
                    style={{ width: `${phase === 'error' ? 100 : barPercent}%` }}
                  />
                </div>
              </div>

              <ol className="space-y-3">
                {STEPS.map((step, i) => {
                  const state =
                    phase === 'error'
                      ? 'idle'
                      : i < stepIndex || phase === 'done'
                        ? 'done'
                        : i === stepIndex
                          ? 'active'
                          : 'idle'
                  return (
                    <li key={step.key} className="flex items-center gap-3">
                      {state === 'active' ? (
                        <span className="w-5 h-5 border-2 border-outline-variant border-t-primary rounded-full animate-spin" />
                      ) : (
                        <span
                          className={`material-symbols-outlined text-[20px] ${
                            state === 'done' ? 'filled-icon text-primary' : 'text-outline'
                          }`}
                        >
                          {state === 'done' ? 'check_circle' : 'radio_button_unchecked'}
                        </span>
                      )}
                      <span className={`text-body-md ${state === 'idle' ? 'text-on-surface-variant' : 'text-on-surface font-medium'}`}>
                        {step.label}
                        {step.key === 'uploading' && phase === 'uploading' && ` · ${Math.round(progress * 100)}%`}
                      </span>
                    </li>
                  )
                })}
              </ol>

              {phase === 'extracting' && (
                <p className="text-body-sm text-secondary">The AI is reading the agreement. This usually takes 10–60 seconds.</p>
              )}

              {phase === 'error' && (
                <div role="alert" className="border-l-4 border-alert-crimson bg-error-container/40 px-4 py-3 space-y-3">
                  <p className="text-body-md text-on-surface">
                    <span className="font-semibold">
                      {failure?.grant ? 'The grant was saved, but extraction failed.' : 'Upload failed.'}
                    </span>{' '}
                    {failure?.message}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={retry}
                      className="bg-primary text-on-primary py-2.5 px-5 font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-tint transition-colors notched-br flex items-center gap-2"
                    >
                      <span className="material-symbols-outlined text-[16px]">refresh</span>
                      Retry
                    </button>
                    {failure?.grant ? (
                      <button
                        onClick={() => {
                          close()
                          navigate('/', { state: { refreshedAt: Date.now() } })
                        }}
                        className="py-2.5 px-5 border border-outline text-primary font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-container transition-colors notched-br"
                      >
                        Go to dashboard
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setFailure(null)
                          setPhase('form')
                        }}
                        className="py-2.5 px-5 border border-outline text-primary font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-container transition-colors notched-br"
                      >
                        Back to form
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
