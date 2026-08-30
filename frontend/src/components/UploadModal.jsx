import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import API_URL from '../lib/api'

export default function UploadModal({ open, onClose, onUploaded }) {
  const navigate = useNavigate()

  const formRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  if (!open) return null

  async function handleSubmit(event) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const name = formData.get('name').trim()
    const funderName = formData.get('funder_name').trim()
    const file = formData.get('file')

    if (!name || !funderName) {
      toast.error('Grant name and funder are required.')
      return
    }
    if (!file || file.size === 0) {
      toast.error('Choose a PDF to upload.')
      return
    }

    try {
      setUploading(true)
      const { data: authData } = await supabase.auth.getSession()
      const token = authData.session?.access_token

      const response = await fetch(`${API_URL}/api/grants`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || `Upload failed (${response.status})`)
      }

      if (payload.obligationError) {
        toast.error(`Upload succeeded but extraction had issues: ${payload.obligationError}`)
        return
      }

      if (payload.extraction?.status !== 'extracted') {
        const reason = payload.extraction?.error
          ? `PDF could not be parsed: ${payload.extraction.error}`
          : 'PDF text extraction failed. The file may be a scanned/image PDF.'
        toast.error(reason)
        return
      }

      if (payload.obligations && payload.obligations.length === 0) {
        toast.error('The AI analyzed the document but found no obligations. The PDF may not contain grant agreement text.')
        return
      }

      formRef.current?.reset()
      toast.success('Grant uploaded and analyzed')
      onClose()
      onUploaded?.()
      navigate(`/grants/${payload.grant.id}/review`, {
        state: { grantName: payload.grant.name },
      })
    } catch (err) {
      toast.error(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 md:p-8 overflow-y-auto">
      <div className="absolute inset-0 bg-black/40" onClick={uploading ? undefined : onClose} />
      <div className="relative w-full max-w-2xl bg-surface-container-lowest inkwell-border notched-card shadow-2xl mt-10 md:mt-16">
        <div className="absolute inset-0 pointer-events-none opacity-5 blueprint-grid text-primary" />
        <div className="relative p-6 md:p-8">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined filled-icon text-primary">upload_file</span>
                <h3 className="font-headline-lg-mobile text-headline-lg-mobile font-semibold text-on-surface">
                  New Grant Agreement
                </h3>
              </div>
              <p className="text-body-sm text-secondary">
                Upload a PDF agreement and GrantGuard will extract its compliance obligations.
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={uploading}
              aria-label="Close upload"
              className="text-secondary hover:text-primary transition-colors p-1 disabled:opacity-40"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <form ref={formRef} onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-12 gap-5 items-end">
            <div className="flex flex-col gap-1 md:col-span-5">
              <label htmlFor="upload-name" className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                Grant Name
              </label>
              <input
                id="upload-name"
                name="name"
                type="text"
                placeholder="e.g. WASH Access Programme 2026"
                className="bg-transparent border-0 border-b border-outline hover:border-primary focus:border-primary focus:outline-none px-0 py-2 font-source-code text-source-code text-on-surface placeholder:text-on-surface-variant/60 transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1 md:col-span-4">
              <label htmlFor="upload-funder" className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                Funder
              </label>
              <input
                id="upload-funder"
                name="funder_name"
                type="text"
                placeholder="e.g. GlobalDev Foundation"
                className="bg-transparent border-0 border-b border-outline hover:border-primary focus:border-primary focus:outline-none px-0 py-2 font-source-code text-source-code text-on-surface placeholder:text-on-surface-variant/60 transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1 md:col-span-3">
              <label htmlFor="upload-file" className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                Agreement PDF (max 15 MB)
              </label>
              <div className="relative">
                <input
                  id="upload-file"
                  name="file"
                  type="file"
                  accept="application/pdf"
                  className="w-full bg-transparent border-0 border-b border-outline hover:border-primary focus:border-primary focus:outline-none py-2 font-source-code text-source-code text-on-surface transition-colors file:mr-3 file:border-0 file:bg-surface-container file:px-3 file:py-1 file:text-on-surface"
                />
              </div>
            </div>
            <div className="md:col-span-12 flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={uploading}
                className="py-3 px-4 border border-outline text-primary font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-container transition-colors notched-br disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={uploading}
                className="bg-primary text-on-primary py-3 px-5 font-label-caps text-label-caps tracking-wider flex items-center justify-center gap-2 hover:bg-surface-tint transition-colors notched-br disabled:opacity-60"
              >
                <span className="material-symbols-outlined filled-icon text-[16px]">auto_awesome</span>
                {uploading ? 'EXTRACTING…' : 'ANALYZE'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
