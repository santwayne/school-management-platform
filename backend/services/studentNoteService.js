import Anthropic from '@anthropic-ai/sdk';
import pool from '../config/db.js';
import { sendTextMessage } from './whatsappService.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Generates an AI note about a student's performance on a test and pushes it
// to the assigned teacher's WhatsApp. Previously queued (studentNoteQueue.add)
// for workers/studentNoteWorker.js to process — moved here and called inline
// so it actually runs (see routes/attendance.js for the same fix and why:
// BullMQ workers need a persistent process, which Vercel serverless functions
// don't provide between requests).
export async function sendStudentNoteNow({ studentId, testId }) {
  const submissions = await pool.query(
    `SELECT question_num, score, justification FROM ai_graded_submissions
     WHERE student_id = $1 AND test_id = $2 ORDER BY question_num ASC`,
    [studentId, testId]
  );
  if (submissions.rowCount === 0) return { skipped: 'no_submissions' };

  const studentRes = await pool.query(`SELECT s.id, s.name, s.class_id FROM students s WHERE s.id = $1`, [studentId]);
  const student = studentRes.rows[0];
  if (!student) return { skipped: 'student_not_found' };

  const testRes = await pool.query(`SELECT subject_id, chapter_id FROM generated_tests WHERE id = $1`, [testId]);
  const test = testRes.rows[0];
  if (!test) return { skipped: 'test_not_found' };

  // subjects.id is numeric but generated_tests.subject_id is a loose free-text
  // field (same convention as syllabus_calendar) — cast to compare.
  const teacherRes = await pool.query(
    `SELECT t.id, t.name, COALESCE(t.whatsapp_number, t.phone) AS phone, t.whatsapp_opt_in_status
     FROM class_subject_teachers cst
     JOIN teachers t ON t.id = cst.teacher_id
     WHERE cst.class_id = $1 AND cst.subject_id::text = $2`,
    [student.class_id, test.subject_id]
  );
  const teacher = teacherRes.rows[0];
  if (!teacher || teacher.whatsapp_opt_in_status !== 'OPTED_IN') {
    console.log(`[studentNoteService] No opted-in teacher assigned for student ${studentId}'s class/subject — skipping note.`);
    return { skipped: 'no_opted_in_teacher' };
  }

  const totalScore = submissions.rows.reduce((sum, r) => sum + Number(r.score || 0), 0);
  const questionSummary = submissions.rows
    .map((r) => `Q${r.question_num}: ${r.score} — ${r.justification}`)
    .join('\n');

  let note;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 300,
      system:
        "You write short, warm, actionable notes for teachers about one student's test performance, " +
        'based on AI-graded answers. 3-4 sentences max. Call out specific weak spots to address in class, ' +
        'not just a score. Plain text, no markdown, in English.',
      messages: [
        {
          role: 'user',
          content: `Student: ${student.name}. Test chapter: ${test.chapter_id}. Total score so far: ${totalScore}.\nPer-question results:\n${questionSummary}`,
        },
      ],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    note = textBlock?.text || `${student.name} scored ${totalScore} on the recent ${test.chapter_id} test.`;
  } catch (err) {
    console.error('[studentNoteService] AI note generation failed:', err.message);
    note = `${student.name} scored ${totalScore} on the recent ${test.chapter_id} test. (AI summary unavailable this time.)`;
  }

  try {
    await sendTextMessage(teacher.phone, `📋 Student note — ${student.name}\n\n${note}`);
    console.log(`[studentNoteService] Sent note for ${student.name} to ${teacher.name}`);
    return { sent: true, teacherId: teacher.id };
  } catch (err) {
    console.error(`[studentNoteService] WhatsApp send failed for teacher ${teacher.id}:`, err.message);
    return { sent: false, error: err.message };
  }
}
