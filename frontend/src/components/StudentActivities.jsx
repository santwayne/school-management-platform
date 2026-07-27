import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, PlayCircle } from 'lucide-react';
import { apiRequest } from '../api';
import StudentShell from './StudentShell';

function Lightbox({ item, onClose }) {
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-50 bg-ink/90 flex items-center justify-center p-4" onClick={onClose}>
      {item.media_type === 'video' ? (
        <video src={item.media_url} controls autoPlay className="max-h-[85vh] max-w-full rounded-xl" onClick={(e) => e.stopPropagation()} />
      ) : (
        <img src={item.media_url} alt="" className="max-h-[85vh] max-w-full rounded-xl object-contain" onClick={(e) => e.stopPropagation()} />
      )}
    </div>
  );
}

export default function StudentActivities() {
  const [activities, setActivities] = useState(null);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    apiRequest('/api/activities/feed').then(setActivities).catch((err) => setError(err.message));
  }, []);

  if (error) return <StudentShell><div className="text-terracotta-deep text-sm">{error}</div></StudentShell>;
  if (!activities) return <StudentShell><div className="text-ink-soft text-sm">Loading…</div></StudentShell>;

  return (
    <StudentShell>
    <div className="space-y-5">
      <h1 className="font-display text-2xl text-ink">Activities</h1>
      {activities.length === 0 && (
        <p className="text-sm text-ink-soft">No activities shared yet — check back soon!</p>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        {activities.map((a) => (
          <div key={a.id} className="rounded-2xl bg-white border border-cream-deep/70 overflow-hidden">
            {a.media?.[0] && (
              <button className="block w-full aspect-video bg-cream-deep/50 relative" onClick={() => setLightbox(a.media[0])}>
                {a.media[0].media_type === 'video' ? (
                  <>
                    <video src={a.media[0].media_url} className="w-full h-full object-cover" />
                    <PlayCircle className="absolute inset-0 m-auto text-white w-10 h-10 drop-shadow" />
                  </>
                ) : (
                  <img src={a.media[0].media_url} alt={a.title} className="w-full h-full object-cover" />
                )}
                {a.media.length > 1 && (
                  <span className="absolute bottom-2 right-2 bg-ink/70 text-cream text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                    <ImageIcon size={12} /> +{a.media.length - 1}
                  </span>
                )}
              </button>
            )}
            <div className="p-4">
              <div className="text-xs text-ink-soft">{new Date(a.activity_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
              <h2 className="font-display text-lg text-ink mt-0.5">{a.title}</h2>
              {a.description && <p className="text-sm text-ink-soft mt-1">{a.description}</p>}
            </div>
          </div>
        ))}
      </div>
      <Lightbox item={lightbox} onClose={() => setLightbox(null)} />
    </div>
    </StudentShell>
  );
}
