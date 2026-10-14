import React, { useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { apiUpload } from '../api';

// Upload one image/document for homework or a lesson plan. Calls
// onChange({ url, name }) after the file is stored, or onChange(null) when
// removed. The server only accepts attachment URLs it issued here.
export default function AttachmentField({ value, onChange, label = 'Attachment (optional)' }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    if (file.size > 15 * 1024 * 1024) return setError('File must be under 15 MB.');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const data = await apiUpload('/api/teaching-media/upload', fd);
      onChange({ url: data.url, name: data.name });
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="text-sm text-ink-soft space-y-1">
      <div>{label}</div>
      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-cream-deep/70 px-3 py-2 text-ink">
          <Paperclip className="w-4 h-4 text-terracotta shrink-0" />
          <a href={value.url} target="_blank" rel="noreferrer" className="truncate hover:underline">{value.name}</a>
          <button type="button" onClick={() => onChange(null)} className="ml-auto text-ink-soft hover:text-destructive" aria-label="Remove attachment">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-lg border border-dashed border-cream-deep px-3 py-2 text-left text-ink-soft hover:bg-cream-deep/30 disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : 'Add a photo or document (JPG, PNG, PDF, Word, PowerPoint, Excel)'}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
        onChange={pick}
        className="hidden"
      />
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}
