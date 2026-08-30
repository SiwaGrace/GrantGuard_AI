import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import AppShell from '../components/AppShell'

const DEFAULT_PROFILE = {
  orgName: '',
  taxId: '',
  jurisdiction: '',
  logoDataUrl: '',
}

function storageKey(userId) {
  return `grantguard:profile:${userId}`
}

export default function Settings() {
  const { user } = useAuth()

  const [form, setForm] = useState(DEFAULT_PROFILE)
  const [logoName, setLogoName] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    if (!user) return
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey(user.id)) || 'null')
      setForm({ ...DEFAULT_PROFILE, ...(stored || {}) })
    } catch {
      setForm(DEFAULT_PROFILE)
    }
  }, [user])

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function handleLogo(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Logo must be 5 MB or smaller.')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
      toast.error('Only PNG or JPG images are allowed.')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    setLogoName(file.name)
    const reader = new FileReader()
    reader.onload = () => update('logoDataUrl', reader.result)
    reader.readAsDataURL(file)
  }

  function handleSave() {
    if (!form.orgName.trim()) {
      toast.error('Registered NGO Name is required.')
      return
    }
    try {
      localStorage.setItem(storageKey(user.id), JSON.stringify(form))
      toast.success('Profile saved')
    } catch {
      toast.error('Could not save the profile.')
    }
  }

  function handleCancel() {
    setLogoName('')
    setForm({ ...DEFAULT_PROFILE, orgName: form.orgName })
    toast('Changes reverted', { icon: '↩' })
  }

  const avatarInitial = (user?.email || '?').slice(0, 1).toUpperCase()
  const discretion = form.orgName.trim() || user?.email?.split('@')[0] || 'Organization'

  return (
    <AppShell>
      <div className="flex flex-col h-full space-y-8">
        <header className="inkwell-border-b pb-6 shrink-0">
          <h2 className="font-headline-lg text-headline-lg text-on-surface mb-2">Settings</h2>
          <p className="text-body-md text-body-md text-secondary max-w-2xl">
            Manage organizational preferences, user roles, and compliance integrations. Changes are
            logged to the central audit trail.
          </p>
        </header>

        <section>
          <div className="flex items-center gap-2 mb-6">
            <span className="material-symbols-outlined filled-icon text-primary">domain</span>
            <h3 className="font-label-caps text-label-caps text-on-surface uppercase tracking-widest">
              Organization Profile
            </h3>
          </div>

          <div className="bg-surface-container-lowest inkwell-border p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
              <div className="md:col-span-4 flex flex-col items-center md:items-start border-b md:border-b-0 md:border-r border-outline-variant pb-6 md:pb-0 md:pr-8">
                <span className="font-label-caps text-label-caps text-secondary mb-4 uppercase">
                  Entity Mark
                </span>
                <label className="w-32 h-32 rounded-full border-2 border-dashed border-outline-variant flex flex-col items-center justify-center bg-surface-container hover:bg-surface-container-high transition-colors cursor-pointer relative overflow-hidden group mb-4">
                  {form.logoDataUrl ? (
                    <img src={form.logoDataUrl} alt="Organization logo" className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-secondary group-hover:text-primary mb-1">upload</span>
                      <span className="font-label-caps text-label-caps text-secondary group-hover:text-primary">Upload</span>
                    </>
                  )}
                  <input
                    ref={fileRef}
                    id="settings-logo"
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={handleLogo}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </label>
                <p className="font-source-code text-source-code text-secondary text-center md:text-left">
                  {logoName ? logoName : 'Max 5MB. PNG, JPG.'}
                </p>
              </div>

              <div className="md:col-span-8 space-y-6">
                <div>
                  <label htmlFor="settings-org" className="block font-label-caps text-label-caps text-secondary mb-1 uppercase tracking-wider">
                    Registered NGO Name
                  </label>
                  <input
                    id="settings-org"
                    type="text"
                    value={form.orgName}
                    onChange={(e) => update('orgName', e.target.value)}
                    placeholder={discretion}
                    className="w-full bg-transparent border-0 border-b border-outline-variant hover:border-outline focus:border-primary focus:outline-none font-body-md text-body-md text-on-surface px-0 py-2"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label htmlFor="settings-tax" className="block font-label-caps text-label-caps text-secondary mb-1 uppercase tracking-wider">
                      Tax ID / EIN
                    </label>
                    <input
                      id="settings-tax"
                      type="text"
                      value={form.taxId}
                      onChange={(e) => update('taxId', e.target.value)}
                      placeholder="00-0000000"
                      className="w-full bg-transparent border-0 border-b border-outline-variant hover:border-outline focus:border-primary focus:outline-none font-source-code text-source-code text-on-surface px-0 py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="settings-jurisdiction" className="block font-label-caps text-label-caps text-secondary mb-1 uppercase tracking-wider">
                      Jurisdiction
                    </label>
                    <input
                      id="settings-jurisdiction"
                      type="text"
                      value={form.jurisdiction}
                      onChange={(e) => update('jurisdiction', e.target.value)}
                      placeholder="e.g. United States (501c3)"
                      className="w-full bg-transparent border-0 border-b border-outline-variant hover:border-outline focus:border-primary focus:outline-none font-body-md text-body-md text-on-surface px-0 py-2"
                    />
                  </div>
                </div>

                <div className="pt-4 flex justify-end items-center gap-3">
                  <span className="w-8 h-8 rounded-full bg-surface-container-high inkwell-border flex items-center justify-center overflow-hidden font-label-caps text-label-caps text-primary uppercase mr-auto">
                    {avatarInitial}
                  </span>
                  <button
                    onClick={handleCancel}
                    className="bg-surface border border-outline text-on-surface hover:bg-surface-container-low font-label-caps text-label-caps py-2 px-6 transition-colors notched-br"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    className="bg-primary text-on-primary hover:bg-surface-tint font-label-caps text-label-caps py-2 px-6 transition-colors notched-br"
                  >
                    Save Details
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-surface-container-lowest inkwell-border p-6 flex items-start gap-3">
          <span className="material-symbols-outlined text-primary shrink-0">shield</span>
          <div>
            <h4 className="font-label-caps text-label-caps text-on-surface uppercase tracking-widest mb-1">
              Signed in as {user?.email}
            </h4>
            <p className="text-body-sm text-body-sm text-secondary">
              Profile and settings changes are attributed to your account and recorded in the
              central audit trail.
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  )
}