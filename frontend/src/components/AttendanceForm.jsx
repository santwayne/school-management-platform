import React, { useState } from 'react';
import { apiRequest } from '../api';

export default function AttendanceForm() {
  const [students, setStudents] = useState([
    { id: 101, name: 'Amanpreet Singh' },
    { id: 102, name: 'Harpreet Kaur' },
    { id: 103, name: 'Gurpreet Singh' },
  ]);

  const [attendance, setAttendance] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleStatusChange = (studentId, status) => {
    setAttendance((prev) => ({ ...prev, [studentId]: status }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    const records = Object.keys(attendance).map((id) => ({
      student_id: parseInt(id, 10),
      status: attendance[id],
    }));

    try {
      const data = await apiRequest('/api/attendance/mark', { method: 'POST', body: { records } });
      if (data.success) {
        setMessage('Attendance marked! Auto-escalation triggered for absentees.');
      }
    } catch (err) {
      setMessage(err.message || 'Failed to submit attendance.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white shadow-md rounded-lg mt-10">
      <h2 className="text-2xl font-bold text-gray-800 mb-2">Teacher Attendance Form</h2>
      <p className="text-sm text-gray-500 mb-6">Absentees will receive automatic WhatsApp notifications.</p>

      {message && <div className="p-3 mb-4 text-sm bg-blue-100 text-blue-700 rounded">{message}</div>}

      <form onSubmit={handleSubmit}>
        <div className="divide-y divide-gray-200">
          {students.map((student) => (
            <div key={student.id} className="py-4 flex justify-between items-center">
              <span className="text-gray-700 font-medium">{student.name}</span>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => handleStatusChange(student.id, 'present')}
                  className={`px-4 py-1.5 rounded text-sm font-semibold transition ${
                    attendance[student.id] === 'present' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  Present
                </button>
                <button
                  type="button"
                  onClick={() => handleStatusChange(student.id, 'absent')}
                  className={`px-4 py-1.5 rounded text-sm font-semibold transition ${
                    attendance[student.id] === 'absent' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  Absent
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-6 bg-indigo-600 text-white py-2.5 rounded-md font-medium hover:bg-indigo-700 transition disabled:opacity-50"
        >
          {loading ? 'Submitting...' : 'Submit Attendance'}
        </button>
      </form>
    </div>
  );
}
