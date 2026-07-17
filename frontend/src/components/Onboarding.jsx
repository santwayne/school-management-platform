import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Fingerprint, Upload, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../api';

const STEPS = ['School', 'Branding', 'Attendance', 'Classes', 'Admin', 'Review'];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function StepIndicator({ step }) {
  return (
    <div className="flex items-center gap-1.5 mb-6">
      {STEPS.map((label, i) => (
        <React.Fragment key={label}>
          <div className="flex flex-col items-center gap-1">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                i < step ? 'bg-terracotta text-white' : i === step ? 'bg-terracotta/15 text-terracotta-deep border-2 border-terracotta' : 'bg-cream-deep text-ink-soft'
              }`}
            >
              {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span className="text-[10px] text-ink-soft hidden sm:block">{label}</span>
          </div>
          {i < STEPS.length - 1 && <div className={`h-0.5 flex-1 ${i < step ? 'bg-terracotta' : 'bg-cream-deep'}`} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function StepHeader({ eyebrow, title, sub }) {
  return (
    <div className="mb-6">
      <div className="text-xs font-semibold tracking-wider text-terracotta-deep uppercase">{eyebrow}</div>
      <h2 className="font-display text-2xl text-ink mt-1">{title}</h2>
      {sub && <p className="text-sm text-ink-soft mt-1.5">{sub}</p>}
    </div>
  );
}

const inputClass = 'w-full px-3 py-2.5 text-sm rounded-lg bg-white border border-cream-deep focus:outline-none focus:ring-2 focus:ring-terracotta/40 focus:border-terracotta/60';

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [launched, setLaunched] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [f, setF] = useState({
    schoolName: '',
    city: '',
    schoolType: '',
    studentCount: '',
    logoDataUrl: null,
    attendance: null,
    classes: [{ id: uid(), name: '' }],
    adminName: '',
    adminEmail: '',
    adminPass: '',
    adminPass2: '',
  });

  const update = (k, v) => setF((prev) => ({ ...prev, [k]: v }));
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const canProceed = () => {
    if (step === 0) return f.schoolName.trim().length > 0;
    if (step === 4) return f.adminName.trim() && f.adminEmail.trim() && f.adminPass.length >= 6 && f.adminPass === f.adminPass2;
    return true;
  };

  const handleLogoFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update('logoDataUrl', reader.result);
    reader.readAsDataURL(file);
  };

  const launch = async () => {
    setSubmitting(true);
    setError('');
    try {
      await apiRequest('/api/onboarding', {
        method: 'POST',
        body: {
          schoolName: f.schoolName,
          city: f.city,
          logoDataUrl: f.logoDataUrl,
          attendance: f.attendance,
          classes: f.classes.filter((c) => c.name.trim()),
          adminName: f.adminName,
          adminEmail: f.adminEmail,
          adminPassword: f.adminPass,
        },
      });
      setLaunched(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (launched) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="mx-auto w-16 h-16 rounded-3xl bg-terracotta flex items-center justify-center text-white text-3xl mb-5">✓</div>
          <h1 className="font-display text-2xl text-ink">Submitted for approval</h1>
          <p className="text-sm text-ink-soft mt-2">
            Thanks — {f.schoolName} has been submitted. A Wayne E Solutions team member will review and activate your
            account, then you can log in with {f.adminEmail}.
          </p>
          <Link to="/login" className="inline-block mt-6 px-5 py-2.5 rounded-xl bg-terracotta text-white font-medium hover:bg-terracotta-deep transition">
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-terracotta flex items-center justify-center text-white font-display">W</div>
            <span className="font-display text-lg text-ink">Waynur</span>
          </Link>
          <div className="text-xs text-ink-soft">Step {step + 1} of {STEPS.length}</div>
        </div>
        <StepIndicator step={step} />

        <div className="rounded-3xl bg-white border border-cream-deep/70 p-6 sm:p-8">
          {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive mb-4">{error}</div>}

          {step === 0 && (
            <>
              <StepHeader eyebrow="Step 1" title="Let's start with the basics" sub="Tell us about your school so we can tailor Waynur to fit." />
              <div className="space-y-3">
                <input value={f.schoolName} onChange={(e) => update('schoolName', e.target.value)} placeholder="School name" className={inputClass} />
                <input value={f.city} onChange={(e) => update('city', e.target.value)} placeholder="City" className={inputClass} />
                <select value={f.schoolType} onChange={(e) => update('schoolType', e.target.value)} className={inputClass}>
                  <option value="">School type</option>
                  <option value="primary">Primary</option>
                  <option value="secondary">Secondary</option>
                  <option value="senior">Senior Secondary</option>
                  <option value="all">All levels</option>
                </select>
                <select value={f.studentCount} onChange={(e) => update('studentCount', e.target.value)} className={inputClass}>
                  <option value="">Approximate student count</option>
                  <option value="<200">Under 200</option>
                  <option value="200-500">200–500</option>
                  <option value="500-1000">500–1,000</option>
                  <option value="1000+">1,000+</option>
                </select>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <StepHeader eyebrow="Step 2" title="Add your branding" sub="Optional — you can always set this up later in Settings." />
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-cream-deep rounded-2xl py-10 cursor-pointer hover:border-terracotta/50 transition">
                {f.logoDataUrl ? (
                  <img src={f.logoDataUrl} alt="Logo preview" className="w-16 h-16 rounded-xl object-cover" />
                ) : (
                  <Upload className="w-6 h-6 text-ink-soft" />
                )}
                <span className="text-sm text-ink-soft">{f.logoDataUrl ? 'Change logo' : 'Upload your school logo'}</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => handleLogoFile(e.target.files?.[0])} />
              </label>
            </>
          )}

          {step === 2 && (
            <>
              <StepHeader eyebrow="Step 3" title="How do you track attendance?" sub="This just sets your default — you can change it any time." />
              <div className="grid sm:grid-cols-2 gap-3">
                {[{ key: 'biometric', label: 'Biometric devices', desc: 'We already have (or plan to install) biometric attendance hardware.' },
                  { key: 'manual', label: 'Manual, via teachers', desc: 'Teachers mark attendance from the Teacher Portal / WhatsApp.' }].map((o) => (
                  <button
                    key={o.key}
                    onClick={() => update('attendance', o.key)}
                    className={`text-left p-4 rounded-2xl border-2 transition ${f.attendance === o.key ? 'border-terracotta bg-terracotta/5' : 'border-cream-deep bg-white hover:border-terracotta/40'}`}
                  >
                    <Fingerprint className="w-5 h-5 text-terracotta-deep mb-2" />
                    <div className="text-sm font-semibold text-ink">{o.label}</div>
                    <div className="text-xs text-ink-soft mt-1">{o.desc}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <StepHeader eyebrow="Step 4" title="Set up your first classes" sub="Add a few to start — you can add more any time from Manage School." />
              <div className="space-y-2">
                {f.classes.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-2">
                    <input
                      value={c.name}
                      onChange={(e) => {
                        const updated = [...f.classes];
                        updated[i] = { ...updated[i], name: e.target.value };
                        update('classes', updated);
                      }}
                      placeholder={`Class ${i + 1} name (e.g. Class 8B)`}
                      className={inputClass}
                    />
                    {f.classes.length > 1 && (
                      <button onClick={() => update('classes', f.classes.filter((x) => x.id !== c.id))} className="p-2 text-ink-soft hover:text-destructive shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => update('classes', [...f.classes, { id: uid(), name: '' }])}
                  className="inline-flex items-center gap-1.5 text-sm text-terracotta-deep font-medium hover:text-terracotta"
                >
                  <Plus className="w-4 h-4" /> Add another class
                </button>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <StepHeader eyebrow="Step 5" title="Create your admin account" sub="This is what you'll use to log in as Principal." />
              <div className="space-y-3">
                <input value={f.adminName} onChange={(e) => update('adminName', e.target.value)} placeholder="Your name" className={inputClass} />
                <input value={f.adminEmail} onChange={(e) => update('adminEmail', e.target.value)} type="email" placeholder="Email" className={inputClass} />
                <input value={f.adminPass} onChange={(e) => update('adminPass', e.target.value)} type="password" placeholder="Password (min. 6 characters)" className={inputClass} />
                <input value={f.adminPass2} onChange={(e) => update('adminPass2', e.target.value)} type="password" placeholder="Confirm password" className={inputClass} />
                {f.adminPass && f.adminPass2 && f.adminPass !== f.adminPass2 && (
                  <p className="text-xs text-destructive">Passwords don't match.</p>
                )}
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <StepHeader eyebrow="Step 6" title="Ready to launch?" sub="Have a quick look — you can change any of this later." />
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-2 border-b border-cream-deep/60"><span className="text-ink-soft">School</span><span className="font-medium text-ink">{f.schoolName || '—'}</span></div>
                <div className="flex justify-between py-2 border-b border-cream-deep/60"><span className="text-ink-soft">City</span><span className="font-medium text-ink">{f.city || '—'}</span></div>
                <div className="flex justify-between py-2 border-b border-cream-deep/60"><span className="text-ink-soft">Attendance</span><span className="font-medium text-ink capitalize">{f.attendance || '—'}</span></div>
                <div className="flex justify-between py-2 border-b border-cream-deep/60"><span className="text-ink-soft">Classes</span><span className="font-medium text-ink">{f.classes.filter((c) => c.name.trim()).length}</span></div>
                <div className="flex justify-between py-2"><span className="text-ink-soft">Admin</span><span className="font-medium text-ink">{f.adminName} · {f.adminEmail}</span></div>
              </div>
              <p className="text-xs text-ink-soft mt-4">
                After you launch, your school is submitted for approval — a Wayne E Solutions team member activates it before you can log in.
              </p>
            </>
          )}

          <div className="flex items-center justify-between mt-8 pt-5 border-t border-cream-deep/60">
            <button onClick={back} disabled={step === 0} className="inline-flex items-center gap-1 text-sm text-ink-soft disabled:opacity-40 hover:text-ink">
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            {step < STEPS.length - 1 ? (
              <button
                onClick={next}
                disabled={!canProceed()}
                className="inline-flex items-center gap-1 px-5 py-2.5 rounded-xl bg-terracotta text-white font-medium hover:bg-terracotta-deep transition disabled:opacity-40"
              >
                Continue <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={launch}
                disabled={submitting}
                className="inline-flex items-center gap-1 px-5 py-2.5 rounded-xl bg-terracotta text-white font-medium hover:bg-terracotta-deep transition disabled:opacity-60"
              >
                {submitting ? 'Launching…' : 'Launch Waynur'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
