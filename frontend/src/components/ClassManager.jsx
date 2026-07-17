import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';

export default function ClassManager() {
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [roster, setRoster] = useState({ students: [], assignments: [] });

  const [newClass, setNewClass] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [studentName, setStudentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadBaseData = async () => {
    try {
      const [classesData, subjectsData, teachersData] = await Promise.all([
        apiRequest('/api/academics/classes', { method: 'GET' }),
        apiRequest('/api/academics/subjects', { method: 'GET' }),
        apiRequest('/api/academics/teachers', { method: 'GET' }),
      ]);
      setClasses(classesData);
      setSubjects(subjectsData);
      setTeachers(teachersData);
      if (classesData.length > 0 && !selectedClass) {
        setSelectedClass(classesData[0].id);
      }
    } catch (err) {
      setError('Failed to load classes/subjects/teachers.');
    }
  };

  const loadRoster = async () => {
    if (!selectedClass) return;
    try {
      const data = await apiRequest(`/api/academics/class/${selectedClass}/roster`, { method: 'GET' });
      setRoster(data);
    } catch (err) {
      setError('Failed to load class roster.');
    }
  };

  useEffect(() => {
    loadBaseData();
  }, []);

  useEffect(() => {
    loadRoster();
  }, [selectedClass]);

  const handleAddClass = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await apiRequest('/api/academics/classes', { method: 'POST', body: { name: newClass } });
      setNewClass('');
      loadBaseData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddSubject = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await apiRequest('/api/academics/subjects', { method: 'POST', body: { name: newSubject } });
      setNewSubject('');
      loadBaseData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSetTeacherWhatsapp = async (teacherId, whatsappNumber) => {
    setError('');
    try {
      await apiRequest(`/api/teachers/${teacherId}/whatsapp`, { method: 'POST', body: { whatsapp_number: whatsappNumber } });
      setMessage('Teacher WhatsApp number saved.');
      loadBaseData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAssignTeacher = async (classId, subjectId, teacherId) => {
    if (!teacherId) return;
    setError('');
    try {
      await apiRequest('/api/academics/assign-teacher', {
        method: 'POST',
        body: { class_id: classId, subject_id: subjectId, teacher_id: teacherId },
      });
      loadRoster();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddStudent = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await apiRequest('/api/academics/students/bulk', {
        method: 'POST',
        body: { class_id: selectedClass, students: [{ name: studentName, parent_phone: parentPhone }] },
      });
      setStudentName('');
      setParentPhone('');
      setMessage('Student enrolled.');
      loadRoster();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCSVUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target.result;
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      const parsedStudents = lines.slice(1).map((line) => {
        const [name, parent_phone] = line.split(',');
        return { name: name?.trim(), parent_phone: parent_phone?.trim() };
      });

      try {
        const res = await apiRequest('/api/academics/students/bulk', {
          method: 'POST',
          body: { class_id: selectedClass, students: parsedStudents },
        });
        setMessage(`Enrolled ${res.inserted_count} students.`);
        loadRoster();
      } catch (err) {
        setError(err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <h1 className="font-display text-3xl font-bold text-ink">Classes, Subjects & Assignments</h1>
      {message && <div className="p-3 bg-green-100 text-green-700 text-sm rounded">{message}</div>}
      {error && <div className="p-3 bg-red-100 text-destructive text-sm rounded">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="space-y-6">
          <div className="bg-white p-5 border rounded-lg shadow-sm space-y-3">
            <h2 className="text-lg font-semibold text-ink">Teacher WhatsApp Numbers</h2>
            <p className="text-xs text-ink-soft">Teachers don't log in — set their WhatsApp number here so they get "what to teach today" and student notes automatically.</p>
            {teachers.map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <span className="text-sm text-ink-soft w-32 truncate">{t.name}</span>
                <input
                  type="text"
                  placeholder="+91..."
                  defaultValue={t.whatsapp_number || ''}
                  onBlur={(e) => e.target.value && handleSetTeacherWhatsapp(t.id, e.target.value)}
                  className="flex-1 p-1.5 border text-xs rounded"
                />
                {t.whatsapp_opt_in_status === 'OPTED_IN' && <span className="text-xs text-emerald-600">✓</span>}
              </div>
            ))}
          </div>

          <form onSubmit={handleAddClass} className="bg-white p-5 border rounded-lg shadow-sm space-y-3">
            <h2 className="text-lg font-semibold text-ink">Add Class</h2>
            <input type="text" placeholder="e.g. Class 8A" value={newClass} onChange={(e) => setNewClass(e.target.value)} required className="w-full p-2 border text-sm rounded" />
            <button type="submit" className="w-full py-2 bg-terracotta hover:bg-terracotta-deep text-white rounded text-sm font-medium">Create Class</button>
          </form>

          <form onSubmit={handleAddSubject} className="bg-white p-5 border rounded-lg shadow-sm space-y-3">
            <h2 className="text-lg font-semibold text-ink">Add Subject</h2>
            <input type="text" placeholder="e.g. Mathematics" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} required className="w-full p-2 border text-sm rounded" />
            <button type="submit" className="w-full py-2 bg-terracotta hover:bg-terracotta-deep text-white rounded text-sm font-medium">Create Subject</button>
          </form>

          <form onSubmit={handleAddStudent} className="bg-white p-5 border rounded-lg shadow-sm space-y-3">
            <h2 className="text-lg font-semibold text-ink">Add Student</h2>
            <select value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)} className="w-full p-2 border text-sm rounded bg-white">
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input type="text" placeholder="Full Name" value={studentName} onChange={(e) => setStudentName(e.target.value)} required className="w-full p-2 border text-sm rounded" />
            <input type="text" placeholder="Parent Mobile (optional)" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} className="w-full p-2 border text-sm rounded" />
            <button type="submit" className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-medium">Enroll Student</button>
          </form>

          <div className="bg-white p-5 border rounded-lg shadow-sm space-y-2">
            <h2 className="text-lg font-semibold text-ink">Bulk CSV Upload</h2>
            <p className="text-xs text-ink-soft">Header row required, format: <code>name,parent_phone</code> — students go into the class selected above.</p>
            <input type="file" accept=".csv" onChange={handleCSVUpload} className="block w-full text-xs text-ink-soft file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-terracotta/5 file:text-terracotta-deep hover:file:bg-terracotta/10" />
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-6 border rounded-lg shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="font-display text-xl font-bold text-ink">Subject → Teacher Assignment</h2>
              <select value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)} className="p-2 border text-sm rounded bg-white font-medium">
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {subjects.length === 0 && <p className="text-sm text-ink-soft">Add a subject first.</p>}

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-ink-soft border-b">
                  <th className="py-2">Subject</th>
                  <th className="py-2">Teacher</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {subjects.map((subj) => {
                  const existing = roster.assignments.find((a) => a.subject_id === subj.id);
                  return (
                    <tr key={subj.id}>
                      <td className="py-2 font-medium text-ink">{subj.name}</td>
                      <td className="py-2">
                        <select
                          defaultValue={existing?.teacher_id || ''}
                          onChange={(e) => handleAssignTeacher(selectedClass, subj.id, e.target.value)}
                          className="p-1.5 border text-sm rounded bg-white w-56"
                        >
                          <option value="">— Unassigned —</option>
                          {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="bg-white p-6 border rounded-lg shadow-sm">
            <h2 className="font-display text-xl font-bold text-ink mb-3">Class Roster ({roster.students.length} students)</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-ink-soft border-b">
                  <th className="py-2">Name</th>
                  <th className="py-2">Login ID</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {roster.students.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2">{s.name}</td>
                    <td className="py-2 font-mono text-xs">{s.login_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
