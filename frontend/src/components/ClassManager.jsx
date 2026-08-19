import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import { normalizePhone } from '../lib/phone';

export default function ClassManager() {
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [parents, setParents] = useState([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [roster, setRoster] = useState({ students: [], assignments: [] });

  const [newClass, setNewClass] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [studentName, setStudentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // The PIN is only ever returned once, right at enrollment (only its bcrypt
  // hash is stored after that) - shown here until dismissed so it isn't lost
  // the moment the "Student enrolled" toast disappears.
  const [provisionedStudents, setProvisionedStudents] = useState([]);

  const loadBaseData = async () => {
    try {
      const [classesData, subjectsData, teachersData, parentsData] = await Promise.all([
        apiRequest('/api/academics/classes', { method: 'GET' }),
        apiRequest('/api/academics/subjects', { method: 'GET' }),
        apiRequest('/api/academics/teachers', { method: 'GET' }),
        apiRequest('/api/academics/parents', { method: 'GET' }),
      ]);
      setClasses(classesData);
      setSubjects(subjectsData);
      setTeachers(teachersData);
      setParents(parentsData);
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
    const normalized = normalizePhone(whatsappNumber);
    if (!normalized) {
      setError('Enter a valid WhatsApp number (10 digits, optionally with +91).');
      return;
    }
    try {
      await apiRequest(`/api/teachers/${teacherId}/whatsapp`, { method: 'POST', body: { whatsapp_number: normalized } });
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

  // Class incharge — the one teacher who can approve this class's student
  // leave requests (see backend/routes/studentLeave.js's canReviewClass).
  // Any teacher assigned to a subject in the class can be made incharge,
  // not just subject-specific assignees, since it's a whole-class role.
  const handleSetClassTeacher = async (classId, teacherId) => {
    setError('');
    try {
      await apiRequest(`/api/profiles/classes/${classId}/class-teacher`, {
        method: 'PATCH',
        body: { teacher_id: teacherId || null },
      });
      setMessage('Class incharge updated.');
      loadBaseData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddStudent = async (e) => {
    e.preventDefault();
    setError('');
    // Parent phone is optional here — only validate/normalize when one was
    // actually typed in, don't block enrolling a student with no parent yet.
    let normalizedPhone = '';
    if (parentPhone.trim()) {
      normalizedPhone = normalizePhone(parentPhone);
      if (!normalizedPhone) {
        setError('Enter a valid parent mobile number (10 digits, optionally with +91), or leave it blank.');
        return;
      }
    }
    try {
      const res = await apiRequest('/api/academics/students/bulk', {
        method: 'POST',
        body: { class_id: selectedClass, students: [{ name: studentName, parent_phone: normalizedPhone }] },
      });
      setStudentName('');
      setParentPhone('');
      setMessage('Student enrolled.');
      setProvisionedStudents(res.records || []);
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
        setProvisionedStudents(res.records || []);
        loadRoster();
      } catch (err) {
        setError(err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSetParent = async (studentId, parentId) => {
    setError('');
    try {
      await apiRequest(`/api/academics/students/${studentId}`, {
        method: 'PATCH',
        body: { parent_id: parentId || null },
      });
      loadRoster();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <h1 className="font-display text-3xl font-bold text-ink">Classes, Subjects & Assignments</h1>
      {message && <div className="p-3 bg-green-100 text-green-700 text-sm rounded">{message}</div>}
      {error && <div className="p-3 bg-red-100 text-destructive text-sm rounded">{error}</div>}

      {provisionedStudents.length > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg space-y-2">
          <div className="flex justify-between items-start">
            <h3 className="text-sm font-semibold text-amber-900">
              Login PIN{provisionedStudents.length > 1 ? 's' : ''} — write this down now, it won't be shown again
            </h3>
            <button onClick={() => setProvisionedStudents([])} className="text-xs text-amber-700 hover:text-amber-900">Dismiss ✕</button>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-amber-200">
              {provisionedStudents.map((s) => (
                <tr key={s.id}>
                  <td className="py-1 pr-4">{s.name}</td>
                  <td className="py-1 pr-4 font-mono text-xs text-amber-800">{s.login_id}</td>
                  <td className="py-1 font-mono text-base font-bold text-amber-900">{s.defaultPin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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

            <div className="flex items-center gap-2 pb-2 border-b">
              <span className="text-sm text-ink-soft w-32 shrink-0">Class Incharge</span>
              <select
                value={classes.find((c) => String(c.id) === String(selectedClass))?.class_teacher_id || ''}
                onChange={(e) => handleSetClassTeacher(selectedClass, e.target.value)}
                className="flex-1 p-1.5 border text-sm rounded bg-white"
              >
                <option value="">— Unassigned —</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <p className="text-xs text-ink-soft -mt-2">The class incharge is the only teacher who can approve this class's student leave requests.</p>

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
                          value={existing?.teacher_id || ''}
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
                  <th className="py-2">Parent</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {roster.students.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2">{s.name}</td>
                    <td className="py-2 font-mono text-xs">{s.login_id}</td>
                    <td className="py-2">
                      <select
                        value={s.parent_id || ''}
                        onChange={(e) => handleSetParent(s.id, e.target.value)}
                        className="p-1.5 border text-xs rounded bg-white w-48"
                      >
                        <option value="">— Not linked —</option>
                        {parents.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.phone})</option>)}
                      </select>
                    </td>
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
