import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ClassManager from './ClassManager';
import SyllabusManager from './SyllabusManager';
import FeeCollectorsCard from './FeeCollectorsCard';
import TeachersTab from './manage/TeachersTab';
import StudentsTab from './manage/StudentsTab';
import ParentsTab from './manage/ParentsTab';

const TABS = [
  { key: 'classes', label: 'Classes & Sections' },
  { key: 'syllabus', label: 'Syllabus' },
  { key: 'teachers', label: 'Staff' },
  { key: 'students', label: 'Students' },
  { key: 'parents', label: 'Parents' },
  { key: 'collectors', label: 'Fee Collectors' },
];
const TAB_KEYS = new Set(TABS.map((t) => t.key));

export default function ManageSchool() {
  // Lets other screens (the post-signup setup checklist on the dashboard)
  // deep-link straight to a tab here, e.g. /admin/manage?tab=teachers,
  // instead of dropping a principal on "Classes" and making them find
  // Staff/Students/Parents themselves.
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState(TAB_KEYS.has(requestedTab) ? requestedTab : 'classes');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-ink">Manage School</h1>
        <p className="text-sm text-ink-soft mt-1">Set up classes, staff, students and their parents.</p>
      </div>
      <div className="border-b border-cream-deep/70 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              tab === t.key ? 'border-terracotta text-terracotta-deep' : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'classes' && <div className="-mx-6"><ClassManager /></div>}
      {tab === 'syllabus' && <div className="-mx-6"><SyllabusManager /></div>}
      {tab === 'teachers' && <TeachersTab />}
      {tab === 'students' && <StudentsTab />}
      {tab === 'parents' && <ParentsTab />}
      {tab === 'collectors' && (
        <div className="rounded-2xl bg-white border border-cream-deep/70 p-5 max-w-2xl">
          <FeeCollectorsCard />
        </div>
      )}
    </div>
  );
}
