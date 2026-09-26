// ------------------------------------------------------------------
// Timetable solver (pure, no DB).
//
// Hard rules (never broken in the output; unplaceable lessons are reported):
//   - a class has one lesson per period
//   - a teacher is in one place per period
//   - a teacher is never placed when marked unavailable
//   - a subject appears at most maxSameSubjectPerDay times a day for a class
// Soft preferences (minimised by local search):
//   - spread a subject across the week (no repeats on a day when avoidable)
//   - avoid a teacher teaching more than maxConsecutive periods in a row
//   - keep "heavy" subjects (flagged) out of the last period
//
// Deterministic for a given seed, so a school gets the same result for the
// same inputs, and tests are stable.
// ------------------------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * input: {
 *   days: [1..6], periodsPerDay: 8,
 *   requirements: [{ class_id, subject_id, teacher_id, room_id?, periods_per_week, heavy?: bool }],
 *   unavailable: [{ teacher_id, day, period }],
 *   maxConsecutive: 3, maxSameSubjectPerDay: 2, seed: 1, timeLimitMs: 5000
 * }
 * output: { slots: [{ class_id, day, period, subject_id, teacher_id, room_id }], unplaced: [...], penalty, stats }
 *
 * room_id is optional per requirement — a lesson with none is placed exactly
 * as before (no room constraint at all). One with a room_id can never be
 * placed in the same room, same day, same period as another such lesson,
 * same hard-gate treatment as teacher double-booking.
 */
export function solveTimetable(input) {
  const days = input.days?.length ? input.days : [1, 2, 3, 4, 5, 6];
  const P = input.periodsPerDay || 8;
  const maxConsecutive = input.maxConsecutive ?? 3;
  const maxSame = input.maxSameSubjectPerDay ?? 2;
  const rand = mulberry32(input.seed ?? 1);
  // The iteration budget decides when to stop (so the same input always
  // gives the same timetable); the time limit is only a safety net.
  const maxIterations = input.maxIterations ?? 30000;
  const deadline = Date.now() + (input.timeLimitMs ?? 20000);

  const unavailable = new Set((input.unavailable || []).map((u) => `${u.teacher_id}:${u.day}:${u.period}`));
  const classGrid = new Map(); // `${class}:${day}:${period}` -> lesson
  const teacherGrid = new Map(); // `${teacher}:${day}:${period}` -> lesson
  const roomGrid = new Map(); // `${room}:${day}:${period}` -> lesson
  const sameCount = new Map(); // `${class}:${subject}:${day}` -> n

  // Expand requirements into individual lessons.
  const lessons = [];
  for (const r of input.requirements || []) {
    for (let i = 0; i < r.periods_per_week; i++) lessons.push({ id: lessons.length, class_id: r.class_id, subject_id: r.subject_id, teacher_id: r.teacher_id ?? null, room_id: r.room_id ?? null, heavy: !!r.heavy, ppw: r.periods_per_week });
  }

  // Most-constrained first: teachers with the most lessons, then subjects
  // with the most periods, then classes with the fullest week.
  const teacherLoad = new Map();
  const classLoad = new Map();
  for (const l of lessons) {
    if (l.teacher_id) teacherLoad.set(l.teacher_id, (teacherLoad.get(l.teacher_id) || 0) + 1);
    classLoad.set(l.class_id, (classLoad.get(l.class_id) || 0) + 1);
  }
  const order = [...lessons].sort(
    (a, b) => (teacherLoad.get(b.teacher_id) || 0) - (teacherLoad.get(a.teacher_id) || 0) || b.ppw - a.ppw || (classLoad.get(b.class_id) || 0) - (classLoad.get(a.class_id) || 0) || a.id - b.id
  );

  const k = (...p) => p.join(':');
  const canPlace = (l, day, period) => {
    if (classGrid.has(k(l.class_id, day, period))) return false;
    if (l.teacher_id && (teacherGrid.has(k(l.teacher_id, day, period)) || unavailable.has(k(l.teacher_id, day, period)))) return false;
    if (l.room_id && roomGrid.has(k(l.room_id, day, period))) return false;
    if ((sameCount.get(k(l.class_id, l.subject_id, day)) || 0) >= maxSame) return false;
    return true;
  };
  const place = (l, day, period) => {
    l.day = day;
    l.period = period;
    classGrid.set(k(l.class_id, day, period), l);
    if (l.teacher_id) teacherGrid.set(k(l.teacher_id, day, period), l);
    if (l.room_id) roomGrid.set(k(l.room_id, day, period), l);
    sameCount.set(k(l.class_id, l.subject_id, day), (sameCount.get(k(l.class_id, l.subject_id, day)) || 0) + 1);
  };
  const unplace = (l) => {
    classGrid.delete(k(l.class_id, l.day, l.period));
    if (l.teacher_id) teacherGrid.delete(k(l.teacher_id, l.day, l.period));
    if (l.room_id) roomGrid.delete(k(l.room_id, l.day, l.period));
    sameCount.set(k(l.class_id, l.subject_id, l.day), (sameCount.get(k(l.class_id, l.subject_id, l.day)) || 1) - 1);
    l.day = undefined;
    l.period = undefined;
  };

  // Soft cost of putting lesson l at (day, period), given what's placed.
  const localCost = (l, day, period) => {
    let c = 0;
    const same = sameCount.get(k(l.class_id, l.subject_id, day)) || 0;
    if (same > 0) c += l.ppw <= days.length ? 10 : 3; // repeat on a day
    if (l.heavy && period === P) c += 4;
    if (l.teacher_id) {
      let run = 1;
      for (let p = period - 1; p >= 1 && teacherGrid.has(k(l.teacher_id, day, p)); p--) run++;
      for (let p = period + 1; p <= P && teacherGrid.has(k(l.teacher_id, day, p)); p++) run++;
      if (run > maxConsecutive) c += 6 * (run - maxConsecutive);
    }
    return c;
  };

  const unplaced = [];
  for (const l of order) {
    let best = null;
    for (const day of days) {
      for (let period = 1; period <= P; period++) {
        if (!canPlace(l, day, period)) continue;
        // Small random jitter breaks ties without losing determinism.
        const cost = localCost(l, day, period) + rand() * 0.01;
        if (!best || cost < best.cost) best = { day, period, cost };
      }
    }
    if (best) place(l, best.day, best.period);
    else unplaced.push(l);
  }

  // Total soft penalty (recomputed from scratch; used to judge moves).
  const totalPenalty = () => {
    let pen = 0;
    const perDay = new Map();
    for (const l of lessons) {
      if (l.day === undefined) continue;
      const key = k(l.class_id, l.subject_id, l.day);
      perDay.set(key, (perDay.get(key) || 0) + 1);
      if (l.heavy && l.period === P) pen += 4;
    }
    for (const [key, n] of perDay) {
      if (n > 1) {
        const l = lessons.find((x) => x.day !== undefined && k(x.class_id, x.subject_id, x.day) === key);
        pen += (n - 1) * (l.ppw <= days.length ? 10 : 3);
      }
    }
    const teachers = [...new Set(lessons.map((l) => l.teacher_id).filter(Boolean))];
    for (const t of teachers) {
      for (const day of days) {
        let run = 0;
        for (let p = 1; p <= P; p++) {
          if (teacherGrid.has(k(t, day, p))) {
            run++;
            if (run > maxConsecutive) pen += 6;
          } else run = 0;
        }
      }
    }
    return pen;
  };

  // Local search: move a lesson to a free cell, or swap two lessons of the
  // same class; keep the change if hard rules hold and penalty doesn't rise.
  let penalty = totalPenalty();
  let iterations = 0;
  const placed = lessons.filter((l) => l.day !== undefined);
  while (penalty > 0 && placed.length && Date.now() < deadline && iterations < maxIterations) {
    iterations++;
    const a = placed[Math.floor(rand() * placed.length)];
    const day = days[Math.floor(rand() * days.length)];
    const period = 1 + Math.floor(rand() * P);
    const other = classGrid.get(k(a.class_id, day, period));
    if (other === a) continue;
    const from = { day: a.day, period: a.period };

    // Try the move (into an empty cell) or the swap (with the class's other lesson).
    unplace(a);
    if (other) unplace(other);
    let moved = false;
    if (canPlace(a, day, period)) {
      place(a, day, period);
      if (!other) moved = true;
      else if (canPlace(other, from.day, from.period)) {
        place(other, from.day, from.period);
        moved = true;
      } else {
        unplace(a);
      }
    }
    if (moved) {
      const next = totalPenalty();
      if (next <= penalty) {
        penalty = next;
        continue;
      }
      // Worse: undo.
      unplace(a);
      if (other) unplace(other);
    }
    place(a, from.day, from.period);
    if (other) place(other, day, period);
  }

  // Second chance for unplaced lessons after the search freed things up.
  for (const l of [...unplaced]) {
    outer: for (const day of days) {
      for (let period = 1; period <= P; period++) {
        if (canPlace(l, day, period)) {
          place(l, day, period);
          unplaced.splice(unplaced.indexOf(l), 1);
          break outer;
        }
      }
    }
  }

  return {
    slots: lessons.filter((l) => l.day !== undefined).map((l) => ({ class_id: l.class_id, day: l.day, period: l.period, subject_id: l.subject_id, teacher_id: l.teacher_id, room_id: l.room_id })),
    unplaced: unplaced.map((l) => ({ class_id: l.class_id, subject_id: l.subject_id, teacher_id: l.teacher_id, room_id: l.room_id })),
    penalty: totalPenalty(),
    stats: { lessons: lessons.length, iterations },
  };
}

// Independent checker used by tests and before publishing.
export function hardViolations(slots, unavailableList = [], maxSame = 2) {
  const v = [];
  const seenClass = new Set();
  const seenTeacher = new Set();
  const seenRoom = new Set();
  const same = new Map();
  const unavailable = new Set(unavailableList.map((u) => `${u.teacher_id}:${u.day}:${u.period}`));
  for (const s of slots) {
    const ck = `${s.class_id}:${s.day}:${s.period}`;
    if (seenClass.has(ck)) v.push(`class ${s.class_id} double-booked day ${s.day} period ${s.period}`);
    seenClass.add(ck);
    if (s.teacher_id) {
      const tk = `${s.teacher_id}:${s.day}:${s.period}`;
      if (seenTeacher.has(tk)) v.push(`teacher ${s.teacher_id} double-booked day ${s.day} period ${s.period}`);
      if (unavailable.has(tk)) v.push(`teacher ${s.teacher_id} placed while unavailable day ${s.day} period ${s.period}`);
      seenTeacher.add(tk);
    }
    if (s.room_id) {
      const rk = `${s.room_id}:${s.day}:${s.period}`;
      if (seenRoom.has(rk)) v.push(`room ${s.room_id} double-booked day ${s.day} period ${s.period}`);
      seenRoom.add(rk);
    }
    const sk = `${s.class_id}:${s.subject_id}:${s.day}`;
    same.set(sk, (same.get(sk) || 0) + 1);
    if (same.get(sk) > maxSame) v.push(`subject ${s.subject_id} more than ${maxSame}x on day ${s.day} for class ${s.class_id}`);
  }
  return v;
}
