import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import pool from '../config/db.js';

dotenv.config();

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── School & Principal (idempotent) ──────────────────────
    const existingPrincipal = await client.query(
      `SELECT id, school_id FROM teachers WHERE email = 'ptpankajsmailbox99@gmail.com'`
    );

    let schoolId, principalId;

    if (existingPrincipal.rowCount > 0) {
      principalId = existingPrincipal.rows[0].id;
      if (existingPrincipal.rows[0].school_id) {
        schoolId = existingPrincipal.rows[0].school_id;
        console.log(`Using existing principal id=${principalId}, school_id=${schoolId}`);
      } else {
        const schoolRes = await client.query(
          `INSERT INTO schools (name, plan, status)
           VALUES ('Sunrise Modern School', 'growth', 'active') RETURNING id`
        );
        schoolId = schoolRes.rows[0].id;
        await client.query(`UPDATE teachers SET school_id=$1, role='principal' WHERE id=$2`, [schoolId, principalId]);
        console.log(`School created: id=${schoolId}, linked to existing principal`);
      }
    } else {
      const schoolRes = await client.query(
        `INSERT INTO schools (name, plan, status)
         VALUES ('Sunrise Modern School', 'growth', 'active') RETURNING id`
      );
      schoolId = schoolRes.rows[0].id;
      console.log(`School created: id=${schoolId}`);

      const principalHash = await bcrypt.hash('12345678', 10);
      const principalRes = await client.query(
        `INSERT INTO teachers (school_id, name, email, phone, password_hash, role)
         VALUES ($1, 'Pankaj Sharma', 'ptpankajsmailbox99@gmail.com', '+919876500001', $2, 'principal') RETURNING id`,
        [schoolId, principalHash]
      );
      principalId = principalRes.rows[0].id;
      console.log(`Principal created: id=${principalId}`);
    }

    // ── Classes (idempotent) ────────────────────────────────
    const classNames = ['Class 6A', 'Class 7A', 'Class 8A', 'Class 9A', 'Class 10A'];
    const classIds = [];
    for (const name of classNames) {
      const existing = await client.query(
        `SELECT id FROM classes WHERE school_id = $1 AND name = $2`, [schoolId, name]
      );
      if (existing.rowCount > 0) {
        classIds.push(existing.rows[0].id);
      } else {
        const r = await client.query(
          `INSERT INTO classes (school_id, name) VALUES ($1, $2) RETURNING id`, [schoolId, name]
        );
        classIds.push(r.rows[0].id);
      }
    }
    console.log(`Classes: ${classIds}`);

    // ── Subjects (idempotent via UNIQUE(school_id,name)) ────
    const subjectNames = ['Mathematics', 'Science', 'English', 'Hindi', 'Social Science', 'Computer Science'];
    const subjectIds = [];
    for (const name of subjectNames) {
      const r = await client.query(
        `INSERT INTO subjects (school_id, name) VALUES ($1, $2)
         ON CONFLICT (school_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [schoolId, name]
      );
      subjectIds.push(r.rows[0].id);
    }
    console.log(`Subjects: ${subjectIds}`);
    // [0]=Math [1]=Sci [2]=Eng [3]=Hin [4]=SST [5]=CS

    // ── Teachers (idempotent via UNIQUE email) ───────────────
    const teacherHash = await bcrypt.hash('teacher123', 10);
    const teachersData = [
      { name: 'Rajesh Kumar',  email: 'rajesh.kumar@sunrise.edu',  phone: '+919876500002' },
      { name: 'Priya Verma',   email: 'priya.verma@sunrise.edu',   phone: '+919876500003' },
      { name: 'Amit Singh',    email: 'amit.singh@sunrise.edu',    phone: '+919876500004' },
      { name: 'Sunita Yadav',  email: 'sunita.yadav@sunrise.edu',  phone: '+919876500005' },
      { name: 'Deepak Gupta',  email: 'deepak.gupta@sunrise.edu',  phone: '+919876500006' },
      { name: 'Meena Patel',   email: 'meena.patel@sunrise.edu',   phone: '+919876500007' },
    ];
    const teacherIds = [];
    for (const t of teachersData) {
      const r = await client.query(
        `INSERT INTO teachers (school_id, name, email, phone, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, 'teacher')
         ON CONFLICT (email) DO UPDATE SET school_id = EXCLUDED.school_id RETURNING id`,
        [schoolId, t.name, t.email, t.phone, teacherHash]
      );
      teacherIds.push(r.rows[0].id);
    }
    console.log(`Teachers: ${teacherIds}`);
    // [0]=Rajesh [1]=Priya [2]=Amit [3]=Sunita [4]=Deepak [5]=Meena

    // ── Accountant (idempotent) ──────────────────────────────
    const accountantHash = await bcrypt.hash('accountant123', 10);
    const accountantRes = await client.query(
      `INSERT INTO teachers (school_id, name, email, phone, password_hash, role)
       VALUES ($1, 'Kavita Joshi', 'kavita.joshi@sunrise.edu', '+919876500010', $2, 'accountant')
       ON CONFLICT (email) DO UPDATE SET school_id = EXCLUDED.school_id RETURNING id`,
      [schoolId, accountantHash]
    );
    const accountantId = accountantRes.rows[0].id;
    console.log(`Accountant: id=${accountantId}`);

    // ── Students + Parents (idempotent via UNIQUE login_id) ──
    const studentsData = [
      { name: 'Aarav Sharma',  login_id: 'SMS001', pin: '1111', grade: 'Class 6',  classIdx: 0, parentName: 'Vikram Sharma',   parentPhone: '+919800000001' },
      { name: 'Diya Patel',    login_id: 'SMS002', pin: '2222', grade: 'Class 6',  classIdx: 0, parentName: 'Ravi Patel',       parentPhone: '+919800000002' },
      { name: 'Rohan Mehta',   login_id: 'SMS003', pin: '3333', grade: 'Class 7',  classIdx: 1, parentName: 'Suresh Mehta',     parentPhone: '+919800000003' },
      { name: 'Ananya Singh',  login_id: 'SMS004', pin: '4444', grade: 'Class 7',  classIdx: 1, parentName: 'Ramesh Singh',     parentPhone: '+919800000004' },
      { name: 'Kabir Verma',   login_id: 'SMS005', pin: '5555', grade: 'Class 8',  classIdx: 2, parentName: 'Anil Verma',       parentPhone: '+919800000005' },
      { name: 'Ishaan Gupta',  login_id: 'SMS006', pin: '6666', grade: 'Class 8',  classIdx: 2, parentName: 'Manoj Gupta',      parentPhone: '+919800000006' },
      { name: 'Priya Yadav',   login_id: 'SMS007', pin: '7777', grade: 'Class 9',  classIdx: 3, parentName: 'Dinesh Yadav',     parentPhone: '+919800000007' },
      { name: 'Arjun Kumar',   login_id: 'SMS008', pin: '8888', grade: 'Class 9',  classIdx: 3, parentName: 'Naresh Kumar',     parentPhone: '+919800000008' },
      { name: 'Sneha Joshi',   login_id: 'SMS009', pin: '9999', grade: 'Class 10', classIdx: 4, parentName: 'Prakash Joshi',    parentPhone: '+919800000009' },
      { name: 'Vivaan Mishra', login_id: 'SMS010', pin: '0000', grade: 'Class 10', classIdx: 4, parentName: 'Santosh Mishra',   parentPhone: '+919800000010' },
    ];

    const studentIds = [];
    for (const s of studentsData) {
      const existing = await client.query(
        `SELECT id FROM students WHERE login_id = $1`, [s.login_id]
      );
      if (existing.rowCount > 0) {
        studentIds.push(existing.rows[0].id);
      } else {
        const parentRes = await client.query(
          `INSERT INTO parents (school_id, name, phone, preferred_language, opt_in_status)
           VALUES ($1, $2, $3, 'hi', 'OPTED_IN') RETURNING id`,
          [schoolId, s.parentName, s.parentPhone]
        );
        const pinHash = await bcrypt.hash(s.pin, 10);
        const sr = await client.query(
          `INSERT INTO students (school_id, class_id, parent_id, name, login_id, pin_hash, grade)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [schoolId, classIds[s.classIdx], parentRes.rows[0].id, s.name, s.login_id, pinHash, s.grade]
        );
        studentIds.push(sr.rows[0].id);
      }
    }
    console.log(`Students: ${studentIds}`);
    // [0,1]=6A  [2,3]=7A  [4,5]=8A  [6,7]=9A  [8,9]=10A

    // ── class_subject_teachers (idempotent via UNIQUE(class_id,subject_id)) ──
    // Rajesh[0]:  Math  for 6A,7A
    // Deepak[4]:  Math  for 8A,9A,10A
    // Priya[1]:   Sci   for 6A,7A
    // Meena[5]:   Sci   for 8A,9A,10A
    // Amit[2]:    Eng   for 6A,7A,8A
    // Sunita[3]:  Eng   for 9A,10A  |  Hindi for 6A,7A,8A
    // Priya[1]:   Hindi for 9A,10A
    // Rajesh[0]:  SST   for 6A,7A,8A
    // Amit[2]:    SST   for 9A,10A
    // Meena[5]:   CS    for all
    const cstAssignments = [
      [0,0,0],[1,0,0],[2,0,4],[3,0,4],[4,0,4],
      [0,1,1],[1,1,1],[2,1,5],[3,1,5],[4,1,5],
      [0,2,2],[1,2,2],[2,2,2],[3,2,3],[4,2,3],
      [0,3,3],[1,3,3],[2,3,3],[3,3,1],[4,3,1],
      [0,4,0],[1,4,0],[2,4,0],[3,4,2],[4,4,2],
      [0,5,5],[1,5,5],[2,5,5],[3,5,5],[4,5,5],
    ]; // [classIdx, subjectIdx, teacherIdx]
    for (const [ci, si, ti] of cstAssignments) {
      await client.query(
        `INSERT INTO class_subject_teachers (school_id, class_id, subject_id, teacher_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT (class_id, subject_id) DO NOTHING`,
        [schoolId, classIds[ci], subjectIds[si], teacherIds[ti]]
      );
    }
    console.log('class_subject_teachers assigned');

    // ── Syllabus Calendar (skip if already seeded for this school) ──
    const syllabusCount = await client.query(
      `SELECT COUNT(*) FROM syllabus_calendar WHERE school_id = $1`, [schoolId]
    );
    if (syllabusCount.rows[0].count === '0') {
      // subject_id in syllabus_calendar is VARCHAR — use full subject names
      const syl = [
        // ── Class 6A ──
        { ci: 0, sub: 'Mathematics', id: '6-MATH-CH1', name: 'Knowing Our Numbers',          s: '2026-06-01', e: '2026-06-14' },
        { ci: 0, sub: 'Mathematics', id: '6-MATH-CH2', name: 'Whole Numbers',                s: '2026-06-15', e: '2026-06-30' },
        { ci: 0, sub: 'Mathematics', id: '6-MATH-CH3', name: 'Playing with Numbers',         s: '2026-07-01', e: '2026-07-20' },
        { ci: 0, sub: 'Mathematics', id: '6-MATH-CH4', name: 'Basic Geometrical Ideas',      s: '2026-07-21', e: '2026-08-10' },
        { ci: 0, sub: 'Mathematics', id: '6-MATH-CH5', name: 'Understanding Elementary Shapes', s: '2026-08-11', e: '2026-08-31' },
        { ci: 0, sub: 'Science',     id: '6-SCI-CH1',  name: 'Food: Where Does It Come From?', s: '2026-06-01', e: '2026-06-12' },
        { ci: 0, sub: 'Science',     id: '6-SCI-CH2',  name: 'Components of Food',           s: '2026-06-13', e: '2026-06-25' },
        { ci: 0, sub: 'Science',     id: '6-SCI-CH3',  name: 'Fibre to Fabric',              s: '2026-06-26', e: '2026-07-10' },
        { ci: 0, sub: 'Science',     id: '6-SCI-CH4',  name: 'Sorting Materials into Groups',s: '2026-07-11', e: '2026-07-31' },
        { ci: 0, sub: 'Science',     id: '6-SCI-CH5',  name: 'Separation of Substances',     s: '2026-08-01', e: '2026-08-20' },
        { ci: 0, sub: 'English',     id: '6-ENG-CH1',  name: 'A Tale of Two Birds',          s: '2026-06-01', e: '2026-06-18' },
        { ci: 0, sub: 'English',     id: '6-ENG-CH2',  name: 'The Friendly Mongoose',        s: '2026-06-19', e: '2026-07-05' },
        { ci: 0, sub: 'English',     id: '6-ENG-CH3',  name: 'The Shepherd\'s Treasure',     s: '2026-07-06', e: '2026-07-25' },
        { ci: 0, sub: 'English',     id: '6-ENG-CH4',  name: 'Tansen',                       s: '2026-07-26', e: '2026-08-15' },
        { ci: 0, sub: 'Hindi',       id: '6-HIN-CH1',  name: 'वह चिड़िया जो',               s: '2026-06-01', e: '2026-06-20' },
        { ci: 0, sub: 'Hindi',       id: '6-HIN-CH2',  name: 'बचपन',                         s: '2026-06-21', e: '2026-07-10' },
        { ci: 0, sub: 'Hindi',       id: '6-HIN-CH3',  name: 'नादान दोस्त',                   s: '2026-07-11', e: '2026-07-31' },
        { ci: 0, sub: 'Social Science', id: '6-SST-CH1', name: 'What, Where, How and When?', s: '2026-06-01', e: '2026-06-20' },
        { ci: 0, sub: 'Social Science', id: '6-SST-CH2', name: 'On the Trail of the Earliest People', s: '2026-06-21', e: '2026-07-10' },
        { ci: 0, sub: 'Social Science', id: '6-SST-CH3', name: 'From Gathering to Growing Food', s: '2026-07-11', e: '2026-07-31' },

        // ── Class 7A ──
        { ci: 1, sub: 'Mathematics', id: '7-MATH-CH1', name: 'Integers',                     s: '2026-06-01', e: '2026-06-16' },
        { ci: 1, sub: 'Mathematics', id: '7-MATH-CH2', name: 'Fractions and Decimals',       s: '2026-06-17', e: '2026-07-05' },
        { ci: 1, sub: 'Mathematics', id: '7-MATH-CH3', name: 'Simple Equations',             s: '2026-07-06', e: '2026-07-25' },
        { ci: 1, sub: 'Mathematics', id: '7-MATH-CH4', name: 'Lines and Angles',             s: '2026-07-26', e: '2026-08-15' },
        { ci: 1, sub: 'Mathematics', id: '7-MATH-CH5', name: 'The Triangle and Its Properties', s: '2026-08-16', e: '2026-09-05' },
        { ci: 1, sub: 'Science',     id: '7-SCI-CH1',  name: 'Nutrition in Plants',          s: '2026-06-01', e: '2026-06-15' },
        { ci: 1, sub: 'Science',     id: '7-SCI-CH2',  name: 'Nutrition in Animals',         s: '2026-06-16', e: '2026-07-01' },
        { ci: 1, sub: 'Science',     id: '7-SCI-CH3',  name: 'Heat',                         s: '2026-07-02', e: '2026-07-20' },
        { ci: 1, sub: 'Science',     id: '7-SCI-CH4',  name: 'Motion and Time',              s: '2026-07-21', e: '2026-08-10' },
        { ci: 1, sub: 'English',     id: '7-ENG-CH1',  name: 'Three Questions',              s: '2026-06-01', e: '2026-06-18' },
        { ci: 1, sub: 'English',     id: '7-ENG-CH2',  name: 'A Gift of Chappals',           s: '2026-06-19', e: '2026-07-08' },
        { ci: 1, sub: 'English',     id: '7-ENG-CH3',  name: 'Gopal and the Hilsa Fish',     s: '2026-07-09', e: '2026-07-28' },
        { ci: 1, sub: 'Hindi',       id: '7-HIN-CH1',  name: 'हम पंछी उन्मुक्त गगन के',    s: '2026-06-01', e: '2026-06-18' },
        { ci: 1, sub: 'Hindi',       id: '7-HIN-CH2',  name: 'दादी माँ',                     s: '2026-06-19', e: '2026-07-08' },
        { ci: 1, sub: 'Hindi',       id: '7-HIN-CH3',  name: 'हिमालय की बेटियाँ',            s: '2026-07-09', e: '2026-07-30' },
        { ci: 1, sub: 'Social Science', id: '7-SST-CH1', name: 'Tracing Changes Through a Thousand Years', s: '2026-06-01', e: '2026-06-20' },
        { ci: 1, sub: 'Social Science', id: '7-SST-CH2', name: 'New Kings and Kingdoms',     s: '2026-06-21', e: '2026-07-10' },
        { ci: 1, sub: 'Social Science', id: '7-SST-CH3', name: 'The Delhi Sultans',          s: '2026-07-11', e: '2026-07-31' },

        // ── Class 8A ──
        { ci: 2, sub: 'Mathematics', id: '8-MATH-CH1', name: 'Rational Numbers',             s: '2026-06-01', e: '2026-06-18' },
        { ci: 2, sub: 'Mathematics', id: '8-MATH-CH2', name: 'Linear Equations in One Variable', s: '2026-06-19', e: '2026-07-10' },
        { ci: 2, sub: 'Mathematics', id: '8-MATH-CH3', name: 'Direct and Inverse Proportions', s: '2026-07-11', e: '2026-07-31' },
        { ci: 2, sub: 'Mathematics', id: '8-MATH-CH4', name: 'Algebraic Expressions and Identities', s: '2026-08-01', e: '2026-08-22' },
        { ci: 2, sub: 'Mathematics', id: '8-MATH-CH5', name: 'Mensuration',                  s: '2026-08-23', e: '2026-09-12' },
        { ci: 2, sub: 'Science',     id: '8-SCI-CH1',  name: 'Crop Production and Management', s: '2026-06-01', e: '2026-06-18' },
        { ci: 2, sub: 'Science',     id: '8-SCI-CH2',  name: 'Microorganisms: Friend and Foe', s: '2026-06-19', e: '2026-07-08' },
        { ci: 2, sub: 'Science',     id: '8-SCI-CH3',  name: 'Synthetic Fibres and Plastics', s: '2026-07-09', e: '2026-07-28' },
        { ci: 2, sub: 'Science',     id: '8-SCI-CH4',  name: 'Materials: Metals and Non-Metals', s: '2026-07-29', e: '2026-08-18' },
        { ci: 2, sub: 'Science',     id: '8-SCI-CH5',  name: 'Combustion and Flame',         s: '2026-08-19', e: '2026-09-08' },
        { ci: 2, sub: 'English',     id: '8-ENG-CH1',  name: 'The Best Christmas Present in the World', s: '2026-06-01', e: '2026-06-18' },
        { ci: 2, sub: 'English',     id: '8-ENG-CH2',  name: 'The Tsunami',                  s: '2026-06-19', e: '2026-07-08' },
        { ci: 2, sub: 'English',     id: '8-ENG-CH3',  name: 'Glimpses of the Past',         s: '2026-07-09', e: '2026-07-28' },
        { ci: 2, sub: 'Hindi',       id: '8-HIN-CH1',  name: 'ध्वनि',                        s: '2026-06-01', e: '2026-06-18' },
        { ci: 2, sub: 'Hindi',       id: '8-HIN-CH2',  name: 'लाख की चूड़ियाँ',              s: '2026-06-19', e: '2026-07-08' },
        { ci: 2, sub: 'Hindi',       id: '8-HIN-CH3',  name: 'बस की यात्रा',                 s: '2026-07-09', e: '2026-07-30' },
        { ci: 2, sub: 'Social Science', id: '8-SST-CH1', name: 'How, When and Where',        s: '2026-06-01', e: '2026-06-20' },
        { ci: 2, sub: 'Social Science', id: '8-SST-CH2', name: 'From Trade to Territory',    s: '2026-06-21', e: '2026-07-10' },
        { ci: 2, sub: 'Social Science', id: '8-SST-CH3', name: 'Ruling the Countryside',     s: '2026-07-11', e: '2026-07-31' },

        // ── Class 9A ──
        { ci: 3, sub: 'Mathematics', id: '9-MATH-CH1', name: 'Number Systems',               s: '2026-06-01', e: '2026-06-20' },
        { ci: 3, sub: 'Mathematics', id: '9-MATH-CH2', name: 'Polynomials',                  s: '2026-06-21', e: '2026-07-12' },
        { ci: 3, sub: 'Mathematics', id: '9-MATH-CH3', name: 'Coordinate Geometry',          s: '2026-07-13', e: '2026-07-31' },
        { ci: 3, sub: 'Mathematics', id: '9-MATH-CH4', name: 'Linear Equations in Two Variables', s: '2026-08-01', e: '2026-08-22' },
        { ci: 3, sub: 'Mathematics', id: '9-MATH-CH5', name: "Introduction to Euclid's Geometry", s: '2026-08-23', e: '2026-09-12' },
        { ci: 3, sub: 'Science',     id: '9-SCI-CH1',  name: 'Matter in Our Surroundings',   s: '2026-06-01', e: '2026-06-18' },
        { ci: 3, sub: 'Science',     id: '9-SCI-CH2',  name: 'Is Matter Around Us Pure?',    s: '2026-06-19', e: '2026-07-08' },
        { ci: 3, sub: 'Science',     id: '9-SCI-CH3',  name: 'Atoms and Molecules',          s: '2026-07-09', e: '2026-07-28' },
        { ci: 3, sub: 'Science',     id: '9-SCI-CH4',  name: 'Structure of the Atom',        s: '2026-07-29', e: '2026-08-18' },
        { ci: 3, sub: 'English',     id: '9-ENG-CH1',  name: 'The Fun They Had',             s: '2026-06-01', e: '2026-06-18' },
        { ci: 3, sub: 'English',     id: '9-ENG-CH2',  name: 'The Sound of Music',           s: '2026-06-19', e: '2026-07-08' },
        { ci: 3, sub: 'English',     id: '9-ENG-CH3',  name: 'The Little Girl',              s: '2026-07-09', e: '2026-07-28' },
        { ci: 3, sub: 'Hindi',       id: '9-HIN-CH1',  name: 'दो बैलों की कथा',             s: '2026-06-01', e: '2026-06-20' },
        { ci: 3, sub: 'Hindi',       id: '9-HIN-CH2',  name: 'ल्हासा की ओर',                 s: '2026-06-21', e: '2026-07-12' },
        { ci: 3, sub: 'Hindi',       id: '9-HIN-CH3',  name: 'साँवले सपनों की याद',          s: '2026-07-13', e: '2026-07-31' },
        { ci: 3, sub: 'Social Science', id: '9-SST-CH1', name: 'The French Revolution',      s: '2026-06-01', e: '2026-06-20' },
        { ci: 3, sub: 'Social Science', id: '9-SST-CH2', name: 'Socialism in Europe and the Russian Revolution', s: '2026-06-21', e: '2026-07-12' },
        { ci: 3, sub: 'Social Science', id: '9-SST-CH3', name: 'Nazism and the Rise of Hitler', s: '2026-07-13', e: '2026-07-31' },

        // ── Class 10A ──
        { ci: 4, sub: 'Mathematics', id: '10-MATH-CH1', name: 'Real Numbers',                s: '2026-06-01', e: '2026-06-18' },
        { ci: 4, sub: 'Mathematics', id: '10-MATH-CH2', name: 'Polynomials',                 s: '2026-06-19', e: '2026-07-08' },
        { ci: 4, sub: 'Mathematics', id: '10-MATH-CH3', name: 'Pair of Linear Equations in Two Variables', s: '2026-07-09', e: '2026-07-28' },
        { ci: 4, sub: 'Mathematics', id: '10-MATH-CH4', name: 'Quadratic Equations',         s: '2026-07-29', e: '2026-08-18' },
        { ci: 4, sub: 'Mathematics', id: '10-MATH-CH5', name: 'Arithmetic Progressions',     s: '2026-08-19', e: '2026-09-08' },
        { ci: 4, sub: 'Science',     id: '10-SCI-CH1',  name: 'Chemical Reactions and Equations', s: '2026-06-01', e: '2026-06-18' },
        { ci: 4, sub: 'Science',     id: '10-SCI-CH2',  name: 'Acids, Bases and Salts',      s: '2026-06-19', e: '2026-07-08' },
        { ci: 4, sub: 'Science',     id: '10-SCI-CH3',  name: 'Metals and Non-metals',       s: '2026-07-09', e: '2026-07-28' },
        { ci: 4, sub: 'Science',     id: '10-SCI-CH4',  name: 'Life Processes',              s: '2026-07-29', e: '2026-08-18' },
        { ci: 4, sub: 'Science',     id: '10-SCI-CH5',  name: 'Control and Coordination',    s: '2026-08-19', e: '2026-09-08' },
        { ci: 4, sub: 'English',     id: '10-ENG-CH1',  name: 'A Letter to God',             s: '2026-06-01', e: '2026-06-18' },
        { ci: 4, sub: 'English',     id: '10-ENG-CH2',  name: 'Nelson Mandela: Long Walk to Freedom', s: '2026-06-19', e: '2026-07-08' },
        { ci: 4, sub: 'English',     id: '10-ENG-CH3',  name: 'Two Stories about Flying',    s: '2026-07-09', e: '2026-07-28' },
        { ci: 4, sub: 'English',     id: '10-ENG-CH4',  name: 'From the Diary of Anne Frank', s: '2026-07-29', e: '2026-08-18' },
        { ci: 4, sub: 'Hindi',       id: '10-HIN-CH1',  name: 'सूरदास — पद',                  s: '2026-06-01', e: '2026-06-18' },
        { ci: 4, sub: 'Hindi',       id: '10-HIN-CH2',  name: 'तुलसीदास — राम-लक्ष्मण-परशुराम संवाद', s: '2026-06-19', e: '2026-07-08' },
        { ci: 4, sub: 'Hindi',       id: '10-HIN-CH3',  name: 'देव — सवैया',                  s: '2026-07-09', e: '2026-07-28' },
        { ci: 4, sub: 'Social Science', id: '10-SST-CH1', name: 'The Rise of Nationalism in Europe', s: '2026-06-01', e: '2026-06-20' },
        { ci: 4, sub: 'Social Science', id: '10-SST-CH2', name: 'Nationalism in India',      s: '2026-06-21', e: '2026-07-12' },
        { ci: 4, sub: 'Social Science', id: '10-SST-CH3', name: 'The Making of a Global World', s: '2026-07-13', e: '2026-07-31' },
        { ci: 4, sub: 'Social Science', id: '10-SST-CH4', name: 'The Age of Industrialisation', s: '2026-08-01', e: '2026-08-22' },
      ];

      for (const row of syl) {
        await client.query(
          `INSERT INTO syllabus_calendar
             (school_id, class_id, subject_id, chapter_id, chapter_name, target_start_date, target_end_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [schoolId, classIds[row.ci], row.sub, row.id, row.name, row.s, row.e]
        );
      }
      console.log(`Syllabus: ${syl.length} chapters inserted`);
    } else {
      console.log('Syllabus already seeded, skipping');
    }

    // ── Performance Snapshots (drift alerts for Principal Dashboard) ──
    const snapCount = await client.query(
      `SELECT COUNT(*) FROM performance_snapshots WHERE school_id = $1`, [schoolId]
    );
    if (snapCount.rows[0].count === '0') {
      const snaps = [
        // Class 8A Science — 3 weeks sustained drift (flagged)
        { ci: 2, ti: 5, sub: 'Science', period: '2026-W25', m: { avg_score: 42, attendance_pct: 68, homework_completion: 55 }, flagged: true,  reason: 'Science scores in Class 8A have dropped 18 points below school baseline for 3+ consecutive weeks. Attendance also below threshold at 68%.' },
        { ci: 2, ti: 5, sub: 'Science', period: '2026-W26', m: { avg_score: 40, attendance_pct: 65, homework_completion: 52 }, flagged: true,  reason: 'Continued underperformance in Class 8A Science. Average score 40/100, attendance down to 65%.' },
        { ci: 2, ti: 5, sub: 'Science', period: '2026-W27', m: { avg_score: 38, attendance_pct: 62, homework_completion: 48 }, flagged: true,  reason: 'Week 3 of sustained drift — Class 8A Science showing declining trend. Immediate principal review recommended.' },
        // Class 9A Mathematics — 3 weeks sustained drift (flagged)
        { ci: 3, ti: 4, sub: 'Mathematics', period: '2026-W25', m: { avg_score: 45, attendance_pct: 70, homework_completion: 60 }, flagged: true,  reason: 'Class 9A Mathematics showing a 15-point drop below school average for 3 consecutive weeks.' },
        { ci: 3, ti: 4, sub: 'Mathematics', period: '2026-W26', m: { avg_score: 43, attendance_pct: 68, homework_completion: 58 }, flagged: true,  reason: 'Continued underperformance in Class 9A Maths. Coordinate Geometry chapter may need additional focus.' },
        { ci: 3, ti: 4, sub: 'Mathematics', period: '2026-W27', m: { avg_score: 41, attendance_pct: 67, homework_completion: 55 }, flagged: true,  reason: 'Third consecutive week of drift in Class 9A Mathematics. Teacher support or syllabus pacing review recommended.' },
        // Healthy classes (not flagged)
        { ci: 0, ti: 0, sub: 'Mathematics', period: '2026-W27', m: { avg_score: 78, attendance_pct: 92, homework_completion: 85 }, flagged: false, reason: null },
        { ci: 1, ti: 1, sub: 'Science',     period: '2026-W27', m: { avg_score: 72, attendance_pct: 88, homework_completion: 80 }, flagged: false, reason: null },
        { ci: 4, ti: 4, sub: 'Mathematics', period: '2026-W27', m: { avg_score: 69, attendance_pct: 86, homework_completion: 76 }, flagged: false, reason: null },
        { ci: 4, ti: 5, sub: 'Science',     period: '2026-W27', m: { avg_score: 65, attendance_pct: 84, homework_completion: 72 }, flagged: false, reason: null },
      ];
      for (const s of snaps) {
        await client.query(
          `INSERT INTO performance_snapshots
             (school_id, class_id, teacher_id, subject_id, period, metrics, flagged, flag_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [schoolId, classIds[s.ci], teacherIds[s.ti], s.sub, s.period, JSON.stringify(s.m), s.flagged, s.reason]
        );
      }
      console.log(`Performance snapshots: ${snaps.length} inserted`);
    } else {
      console.log('Performance snapshots already seeded, skipping');
    }

    // ── School Events ─────────────────────────────────────────
    const evtCount = await client.query(
      `SELECT COUNT(*) FROM school_events WHERE school_id = $1`, [schoolId]
    );
    if (evtCount.rows[0].count === '0') {
      const events = [
        { title: 'Independence Day',            description: 'National holiday — flag hoisting ceremony at 8 AM. All students to attend in school uniform.', date: '2026-08-15', end: null,         type: 'holiday',  audience: 'all' },
        { title: 'Mid-Term Examinations',        description: 'Mid-term exams for Classes 6–10. Syllabus up to 31 August. Hall tickets to be collected from office.', date: '2026-09-01', end: '2026-09-10', type: 'exam',     audience: 'all' },
        { title: "Teacher's Day Celebration",    description: "Celebrating Dr. Radhakrishnan's birthday. Cultural programs organised by senior students.", date: '2026-09-05', end: null,         type: 'general',  audience: 'all' },
        { title: 'Parent-Teacher Meeting (PTM)', description: 'Mid-term PTM. Parents to collect report cards and meet respective subject teachers. 9 AM – 1 PM.', date: '2026-10-10', end: null,         type: 'ptm',      audience: 'all' },
        { title: 'Diwali Vacation',              description: 'School closed for Diwali festival. School reopens 25 October.',                               date: '2026-10-18', end: '2026-10-24', type: 'holiday',  audience: 'all' },
        { title: 'Annual Sports Day',            description: 'Inter-house sports competition. All students must wear house T-shirts. Parents welcome.',      date: '2026-11-14', end: null,         type: 'sports',   audience: 'all' },
        { title: "Children's Day",               description: "Celebrating Pandit Nehru's birthday. Fun activities, quiz competitions, and cultural events.",  date: '2026-11-14', end: null,         type: 'general',  audience: 'students' },
        { title: 'Winter Break',                 description: 'School closed for winter holidays. School reopens 2 January.',                                date: '2026-12-25', end: '2027-01-01', type: 'holiday',  audience: 'all' },
        { title: 'Pre-Board Examinations (Class 10)', description: 'Mock board exams for Class 10 students. Full CBSE pattern.',                            date: '2027-01-15', end: '2027-01-25', type: 'exam',     audience: 'students' },
        { title: 'Annual Examinations',          description: 'Final annual exams for Classes 6–9. Detailed schedule to be shared separately.',              date: '2027-02-20', end: '2027-03-10', type: 'exam',     audience: 'all' },
        { title: 'CBSE Board Exams Begin (Class 10)', description: 'Board examinations commence for Class 10. Students to carry admit cards daily.',       date: '2027-02-15', end: '2027-03-15', type: 'exam',     audience: 'students' },
        { title: 'Annual Prize Distribution',    description: 'Recognising academic and co-curricular excellence. Chief Guest TBA. All parents invited.',    date: '2027-03-20', end: null,         type: 'general',  audience: 'all' },
      ];
      for (const ev of events) {
        await client.query(
          `INSERT INTO school_events
             (school_id, title, description, event_date, end_date, event_type, audience, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [schoolId, ev.title, ev.description, ev.date, ev.end, ev.type, ev.audience, principalId]
        );
      }
      console.log(`School events: ${events.length} inserted`);
    } else {
      console.log('School events already seeded, skipping');
    }

    // ── Exams + Marks (Unit Test 1 — already completed) ───────
    const examCount = await client.query(
      `SELECT COUNT(*) FROM exams WHERE school_id = $1`, [schoolId]
    );
    if (examCount.rows[0].count === '0') {
      // students per class: [0,1]=6A [2,3]=7A [4,5]=8A [6,7]=9A [8,9]=10A
      const byClass = [[0,1],[2,3],[4,5],[6,7],[8,9]];
      // marks[classIdx][subjectIdx] = [score_s0, score_s1]
      const markTable = [
        { ci: 0, scores: [[82,75],[78,70],[85,80],[80,76],[72,68]] }, // 6A healthy
        { ci: 1, scores: [[72,68],[74,71],[80,76],[76,72],[68,65]] }, // 7A healthy
        { ci: 2, scores: [[65,62],[48,42],[70,68],[62,58],[58,55]] }, // 8A — Sci low!
        { ci: 3, scores: [[52,48],[62,58],[72,68],[68,64],[60,57]] }, // 9A — Math low!
        { ci: 4, scores: [[74,70],[68,65],[76,72],[70,66],[64,60]] }, // 10A healthy
      ];

      for (const { ci, scores } of markTable) {
        const examRes = await client.query(
          `INSERT INTO exams (school_id, class_id, name, term) VALUES ($1, $2, $3, 'Term 1') RETURNING id`,
          [schoolId, classIds[ci], `Unit Test 1 — ${classNames[ci]}`]
        );
        const examId = examRes.rows[0].id;
        const [s0, s1] = byClass[ci];

        for (let si = 0; si < 5; si++) { // 5 main subjects
          const [m0, m1] = scores[si];
          await client.query(
            `INSERT INTO exam_marks (school_id, exam_id, student_id, subject_id, marks_obtained, max_marks, entered_by)
             VALUES ($1,$2,$3,$4,$5,100,$6) ON CONFLICT (exam_id,student_id,subject_id) DO NOTHING`,
            [schoolId, examId, studentIds[s0], subjectIds[si], m0, teacherIds[0]]
          );
          await client.query(
            `INSERT INTO exam_marks (school_id, exam_id, student_id, subject_id, marks_obtained, max_marks, entered_by)
             VALUES ($1,$2,$3,$4,$5,100,$6) ON CONFLICT (exam_id,student_id,subject_id) DO NOTHING`,
            [schoolId, examId, studentIds[s1], subjectIds[si], m1, teacherIds[0]]
          );
        }
      }
      console.log('Exams + marks seeded');
    } else {
      console.log('Exams already seeded, skipping');
    }

    // ── Attendance (July 2026 school days) ────────────────────
    const attCount = await client.query(
      `SELECT COUNT(*) FROM attendance WHERE school_id = $1`, [schoolId]
    );
    if (attCount.rows[0].count === '0') {
      // July 2026 weekdays
      const julyDates = [];
      for (let d = 1; d <= 31; d++) {
        const dow = new Date(2026, 6, d).getDay(); // 0=Sun 6=Sat
        if (dow !== 0 && dow !== 6) julyDates.push(`2026-07-${String(d).padStart(2, '0')}`);
      }

      // Absent dates per student index (0-based)
      const absentDates = {
        4: ['2026-07-03','2026-07-10','2026-07-17','2026-07-24'], // Kabir - Class 8A
        5: ['2026-07-07','2026-07-14','2026-07-21','2026-07-28'], // Ishaan - Class 8A
        6: ['2026-07-06','2026-07-20'],                            // Priya Yadav - Class 9A
        2: ['2026-07-15'],                                         // Rohan Mehta
      };
      const lateDates = {
        0: ['2026-07-02','2026-07-09'],
        3: ['2026-07-08','2026-07-22'],
        7: ['2026-07-13'],
        8: ['2026-07-16','2026-07-23'],
      };

      for (const dateStr of julyDates) {
        for (let si = 0; si < studentIds.length; si++) {
          let status = 'present';
          if (absentDates[si] && absentDates[si].includes(dateStr)) status = 'absent';
          else if (lateDates[si] && lateDates[si].includes(dateStr)) status = 'late';

          await client.query(
            `INSERT INTO attendance (school_id, student_id, date, status, marked_by)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (student_id, date) DO NOTHING`,
            [schoolId, studentIds[si], dateStr, status, principalId]
          );
        }
      }
      console.log(`Attendance seeded for ${julyDates.length} school days`);
    } else {
      console.log('Attendance already seeded, skipping');
    }

    // ── Student Payments ──────────────────────────────────────
    const payCount = await client.query(
      `SELECT COUNT(*) FROM student_payment WHERE school_id = $1`, [schoolId]
    );
    if (payCount.rows[0].count === '0') {
      const annualFee = 15000;
      const paidAmounts = [15000, 10000, 15000, 5000, 10000, 10000, 15000, 5000, 15000, 10000];
      for (let i = 0; i < studentIds.length; i++) {
        await client.query(
          `INSERT INTO student_payment (school_id, student_id, amount_due, amount_paid)
           VALUES ($1,$2,$3,$4) ON CONFLICT (student_id) DO NOTHING`,
          [schoolId, studentIds[i], annualFee, paidAmounts[i]]
        );
      }
      console.log('Student payments seeded');
    } else {
      console.log('Student payments already seeded, skipping');
    }

    // ── Teacher Salaries ──────────────────────────────────────
    const salCount = await client.query(
      `SELECT COUNT(*) FROM teacher_salary WHERE school_id = $1`, [schoolId]
    );
    if (salCount.rows[0].count === '0') {
      const salaries = [45000, 42000, 40000, 38000, 50000, 44000]; // Rajesh Priya Amit Sunita Deepak Meena
      for (let i = 0; i < teacherIds.length; i++) {
        await client.query(
          `INSERT INTO teacher_salary (school_id, teacher_id, monthly_amount)
           VALUES ($1,$2,$3) ON CONFLICT (teacher_id) DO NOTHING`,
          [schoolId, teacherIds[i], salaries[i]]
        );
        for (const [period, paidOn, status] of [['2026-05','2026-05-31','PAID'],['2026-06','2026-06-30','PAID'],['2026-07',null,'PENDING']]) {
          await client.query(
            `INSERT INTO teacher_salary_history (school_id, teacher_id, period, amount_paid, paid_on, status)
             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (teacher_id, period) DO NOTHING`,
            [schoolId, teacherIds[i], period, salaries[i], paidOn, status]
          );
        }
      }
      // Accountant salary
      await client.query(
        `INSERT INTO teacher_salary (school_id, teacher_id, monthly_amount)
         VALUES ($1,$2,35000) ON CONFLICT (teacher_id) DO NOTHING`,
        [schoolId, accountantId]
      );
      console.log('Teacher salaries seeded');
    } else {
      console.log('Teacher salaries already seeded, skipping');
    }

    // ── Staff Leave Balances (current year) ───────────────────
    const leaveCount = await client.query(
      `SELECT COUNT(*) FROM staff_leave_balances WHERE school_id = $1`, [schoolId]
    );
    if (leaveCount.rows[0].count === '0') {
      const allStaff = [...teacherIds, accountantId];
      for (const tid of allStaff) {
        for (const [type, total, used] of [['casual',12,2],['sick',10,0],['earned',15,0]]) {
          await client.query(
            `INSERT INTO staff_leave_balances (school_id, teacher_id, year, leave_type, total_days, used_days)
             VALUES ($1,$2,2026,$3,$4,$5) ON CONFLICT (teacher_id, year, leave_type) DO NOTHING`,
            [schoolId, tid, type, total, used]
          );
        }
      }
      console.log('Staff leave balances seeded');
    } else {
      console.log('Staff leave balances already seeded, skipping');
    }

    await client.query('COMMIT');
    console.log('\n✅ Seed complete!\n');
    console.log('─────────────────────────────────────────────────────');
    console.log('PRINCIPAL LOGIN');
    console.log('  Email   : ptpankajsmailbox99@gmail.com');
    console.log('  Password: 12345678');
    console.log('─────────────────────────────────────────────────────');
    console.log('ACCOUNTANT LOGIN');
    console.log('  Email   : kavita.joshi@sunrise.edu');
    console.log('  Password: accountant123');
    console.log('─────────────────────────────────────────────────────');
    console.log('TEACHER LOGINS (password: teacher123)');
    for (const t of teachersData) console.log(`  ${t.email}`);
    console.log('─────────────────────────────────────────────────────');
    console.log('STUDENT LOGINS (login_id / pin)');
    for (const s of studentsData) console.log(`  ${s.login_id} / ${s.pin}  →  ${s.name}`);
    console.log('─────────────────────────────────────────────────────');
    console.log('\nSeeded data summary:');
    console.log('  • 5 classes, 6 subjects, 6 teachers, 1 accountant');
    console.log('  • 10 students with parents');
    console.log('  • 30 class-subject-teacher assignments');
    console.log('  • 80 syllabus chapters (CBSE curriculum, Classes 6–10)');
    console.log('  • 10 performance snapshots (6 flagged drift alerts)');
    console.log('  • 12 school events (holidays, exams, PTM, sports)');
    console.log('  • 5 Unit Test exams with marks for all subjects');
    console.log('  • Attendance for 23 July 2026 school days');
    console.log('  • Student fee records + teacher salary records');
    console.log('  • Staff leave balances for 2026\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
