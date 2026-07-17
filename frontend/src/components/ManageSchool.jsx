import React, { useState } from 'react';
import ClassManager from './ClassManager';
import SyllabusManager from './SyllabusManager';
import FeeCollectorsCard from './FeeCollectorsCard';
import TeachersTab from './manage/TeachersTab';
import StudentsTab from './manage/StudentsTab';
import ParentsTab from './manage/ParentsTab';

const TABS = [
  { key: 'classes', label: 'Classes & Sections' },
  { key: 'syllabus', label: 'Syllabus' },
  { key: 'teachers', label: 'Teachers' },
  { key: 'students', label: 'Students' },
  { key: 'parents', label: 'Parents' },
  { key: 'collectors', label: 'Fee Collectors' },
];

export default function ManageSchool() {
  const [tab, setTab] = useState('classes');

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
