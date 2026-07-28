import React, { useState } from 'react';
import { FileCheck2 } from 'lucide-react';
import DocumentRequestQueue from './DocumentRequestQueue';

// Admin approval queue for student/parent-submitted document requests.
// Certificates (4.4) and ID cards (4.7) are the same underlying
// document_requests table + the same DocumentRequestQueue component —
// only the request_type filter differs, so this page just switches which
// types are passed in rather than rendering two separate implementations.
const SECTIONS = [
  { key: 'certificates', label: 'Certificate requests', types: ['leaving_certificate', 'bonafide'] },
  { key: 'id_cards', label: 'ID card requests', types: ['id_card'] },
];

export default function AdminDocumentRequests() {
  const [section, setSection] = useState('certificates');
  const active = SECTIONS.find((s) => s.key === section);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl text-ink flex items-center gap-2">
          <FileCheck2 className="w-7 h-7 text-terracotta" /> Document Requests
        </h1>
        <p className="text-sm text-ink-soft mt-1">Review and action certificate and ID card requests submitted by students.</p>
      </div>

      <div className="flex gap-2">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition ${
              section === s.key
                ? 'bg-terracotta text-primary-foreground border-terracotta'
                : 'bg-white text-ink-soft border-cream-deep hover:border-terracotta/40'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <DocumentRequestQueue key={active.key} requestTypes={active.types} emptyLabel={`No ${active.label.toLowerCase()} right now.`} />
    </div>
  );
}
