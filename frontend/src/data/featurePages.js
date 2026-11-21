// Public feature pages at /features/<slug>.
// Plain data (no JSX) so the same copy feeds the React page, the FAQPage
// JSON-LD and the build-time pre-render. Edit copy here only.
//
// Rule from the SEO guide: never name a price on these pages — link to /pricing.
// Claims the owner has not confirmed yet were left out on purpose (boards
// supported, alert opt-outs, payment surcharge, reminder languages).

export const FEATURE_PAGES = [
  {
    slug: 'whatsapp-parent-alerts',
    navLabel: 'WhatsApp parent alerts',
    title: 'WhatsApp Alerts for Parents: Absence, Homework, Results | Waynur',
    description: "Send absence, homework, exam result and fee alerts to parents on your school's own WhatsApp number. No app for parents to install.",
    h1: "WhatsApp alerts for parents, from your school's own number",
    lead: "Waynur sends parents the updates they care about (absence, homework, exam results, fees and school activities) on WhatsApp, from the school's own WhatsApp number. Parents don't install any app, and teachers don't type the same message 40 times.",
    sections: [
      {
        h2: 'What parents receive',
        items: [
          'Absence alert the same morning',
          'Homework for the day',
          "Exam results for their own child only",
          'Fee reminders with a payment link',
          'Activity and event notices',
          'Progress notes from teachers',
        ],
      },
      {
        h2: 'Why WhatsApp',
        text: 'Almost every parent in India already reads WhatsApp daily. Messages are seen within minutes, unlike app notifications or SMS that get ignored.',
      },
      {
        h2: 'Privacy',
        text: "Each message goes only to that child's registered parent numbers. Nothing is posted in class groups. Data is hosted in India and handled under the DPDP Act 2023.",
      },
    ],
    faqs: [
      { q: 'Do parents need to download an app?', a: 'No. Alerts arrive on WhatsApp, which parents already use.' },
      { q: 'Whose number do messages come from?', a: "The school's own WhatsApp number, so parents recognise it." },
      { q: 'Are messages posted in class WhatsApp groups?', a: "No. Each message goes only to that child's registered parent numbers." },
    ],
    related: 'exam-results-to-parents',
  },
  {
    slug: 'fee-management',
    navLabel: 'Fee management',
    title: 'School Fee Management Software with WhatsApp Reminders | Waynur',
    description: "Automatic fee reminders on WhatsApp with payment links into the school's own account, and a clear record of who has paid.",
    h1: 'School fee management with WhatsApp reminders',
    lead: "Waynur sends polite fee reminders to parents on WhatsApp with a payment link that goes straight into the school's own account, and keeps a clear list of paid, pending and overdue fees for the accountant and principal.",
    sections: [
      {
        h2: 'How it works',
        steps: [
          'Set the fee structure once.',
          'Waynur reminds parents before and after the due date.',
          'Parents pay from the link.',
          'The payment is recorded against the student.',
        ],
      },
      {
        h2: 'What the office gets',
        items: ['Class-wise pending list', 'Daily collection view', 'Accountant logins', 'Fewer calls and visits about dues'],
      },
    ],
    faqs: [
      { q: 'Does the fee money go to Waynur?', a: "No. Payments go straight into the school's own account. Waynur never holds school fees." },
      { q: 'Can our accountant use it without seeing everything else?', a: 'Yes. Accountants get their own login that shows fees and payroll only.' },
      { q: 'Does the principal see collections?', a: 'Yes. The principal sees paid, pending and overdue fees class by class.' },
    ],
    related: 'whatsapp-parent-alerts',
  },
  {
    slug: 'admission-enquiries-whatsapp',
    navLabel: 'Admission enquiries',
    title: 'School Admission Enquiry Management on WhatsApp | Waynur',
    description: 'Reply to every admission enquiry instantly on WhatsApp, answer common questions and track each family from enquiry to admission.',
    h1: 'Answer every admission enquiry on WhatsApp, even at 10 pm',
    lead: "Waynur's WhatsApp admission assistant replies to parents straight away on the school's own number, answers common questions about classes, documents and visits, and passes serious enquiries to the admissions team. Every enquiry is listed with its status, so none is forgotten.",
    sections: [
      {
        h2: 'What it handles',
        items: [
          'Instant first reply',
          "Answers to the school's top questions, written and approved by the school",
          "Collects the child's name, class and preferred visit time",
          'Offers a campus visit slot',
          'Follow-up for families who went quiet',
        ],
      },
      {
        h2: 'The enquiry list',
        text: 'New, visited, form taken, admitted: every family in one view for the principal.',
      },
    ],
    faqs: [
      { q: 'Does it replace our admissions staff?', a: 'No. It handles first replies and passes families to your team.' },
      { q: 'Can we edit the answers?', a: 'Yes. The school writes and approves the answers it gives.' },
      { q: 'Does it work after office hours?', a: 'Yes. It replies at any time of day.' },
    ],
    related: 'whatsapp-parent-alerts',
  },
  {
    slug: 'exam-results-to-parents',
    navLabel: 'Exam results to parents',
    title: 'Share Exam Results With Parents on WhatsApp, Privately | Waynur',
    description: "Each child's marks go only to that child's own parents on WhatsApp, clearly laid out, the same day results are ready.",
    h1: 'Share exam results with parents on WhatsApp, privately',
    lead: "When marks are entered, Waynur sends each child's subject-wise result only to that child's own parents on WhatsApp. No marks are posted in groups and no report cards get lost in school bags.",
    sections: [
      {
        h2: 'What the parent sees',
        items: ['Subject-wise marks with maximum marks', 'A short teacher remark', 'Next step, such as a PTM date'],
      },
      {
        h2: 'Why it matters',
        text: 'Results reach parents the same day. Children aren\'t embarrassed in front of classmates. Teachers stop answering "what did my child get" calls.',
      },
    ],
    faqs: [
      { q: "Can other parents see my child's marks?", a: "No. Each result goes only to that child's own parents." },
      { q: 'Do report cards still work?', a: 'Yes. Report cards and certificates are generated in Waynur from the same marks.' },
      { q: 'Do teachers enter marks twice?', a: 'No. Marks are entered once and used for both the WhatsApp result and the report card.' },
    ],
    related: 'whatsapp-parent-alerts',
  },
  {
    slug: 'ai-tutor',
    navLabel: 'AI tutor',
    title: 'AI Tutor for School Students That Guides, Not Gives Answers | Waynur',
    description: "Waynur's AI tutor helps students work through problems step by step instead of handing over answers. Built into the school's system.",
    h1: 'An AI tutor that guides students instead of giving answers',
    lead: "Waynur's AI tutor helps students understand a question step by step, with hints and follow-up questions, instead of handing over the final answer. It is part of the school's own system, so the school stays in control.",
    sections: [
      {
        h2: 'How a session works',
        steps: [
          'The student asks a question.',
          "The tutor asks what they've tried.",
          'It gives a hint.',
          'It checks their next step.',
          'It explains the idea once they get there.',
        ],
      },
      {
        h2: 'Made for schools',
        text: 'The tutor is an aid to teaching, not a replacement for teachers. It runs inside the school\'s Waynur account, using the same student logins.',
      },
    ],
    faqs: [
      { q: 'Will students just copy answers?', a: 'No. The tutor is built to guide with hints and questions, not to hand over final answers.' },
      { q: 'Which plan includes it?', a: 'The AI tutor is part of the Waynur AI plan. See the pricing page for details.' },
      { q: 'Does it replace teachers?', a: 'No. It helps students practise between classes; teachers stay in charge of teaching and grading.' },
    ],
    related: 'exam-results-to-parents',
  },
  {
    slug: 'teacher-substitution',
    navLabel: 'Teacher substitution',
    title: 'Teacher Substitution Management Software | Waynur',
    description: 'Mark a teacher absent once, see who is free each period, confirm, and substitutes get the class, period and room on WhatsApp.',
    h1: 'Arrange teacher substitutions in minutes, not hours',
    lead: 'Mark a teacher absent once and Waynur shows which periods need cover, suggests teachers who are free, and sends each substitute the class, period and room on WhatsApp after the coordinator confirms.',
    sections: [
      {
        h2: 'Before and after',
        text: 'Before: a timetable printout, phone calls and a class left waiting. After: one screen, a fair spread of extra periods, and a record of who covered what.',
      },
    ],
    faqs: [
      { q: 'Does it use our own timetable?', a: "Yes. Suggestions come from the school's own timetable in Waynur." },
      { q: 'How do substitute teachers find out?', a: 'Each substitute gets the class, period and room on WhatsApp once the coordinator confirms.' },
      { q: 'Can the principal see who covered what?', a: "Yes. Every substitution is recorded, so the month's cover is visible at a glance." },
    ],
    related: 'whatsapp-parent-alerts',
  },
];

export const FEATURE_BY_SLUG = Object.fromEntries(FEATURE_PAGES.map((p) => [p.slug, p]));

export const SITE = 'https://waynur.com';

export function faqJsonLd(faqs) {
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

export function breadcrumbJsonLd(trail) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      ...(t.path != null ? { item: SITE + t.path } : {}),
    })),
  };
}

export function featureSeo(page) {
  const url = `${SITE}/features/${page.slug}`;
  return {
    title: page.title,
    description: page.description,
    canonical: url,
    robots: 'index, follow',
    ogType: 'website',
    ogSiteName: 'Waynur',
    ogTitle: page.title,
    ogDescription: page.description,
    ogUrl: url,
    ogImage: `${SITE}/og-image.jpg`,
    twitterCard: 'summary_large_image',
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        faqJsonLd(page.faqs),
        breadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Features', path: '/features' },
          { name: page.navLabel, path: `/features/${page.slug}` },
        ]),
      ],
    },
  };
}

// Which feature page a blog post should link to, from its slug/title/tags.
const FEATURE_KEYWORDS = [
  ['fee', 'fee-management'],
  ['admission', 'admission-enquiries-whatsapp'],
  ['enquir', 'admission-enquiries-whatsapp'],
  ['exam', 'exam-results-to-parents'],
  ['result', 'exam-results-to-parents'],
  ['report card', 'exam-results-to-parents'],
  ['tutor', 'ai-tutor'],
  ['substitut', 'teacher-substitution'],
  ['timetable', 'teacher-substitution'],
];

export function featureForPost(post) {
  const hay = [post.slug, post.title, ...(post.tags || [])].join(' ').toLowerCase().replace(/-/g, ' ');
  const hit = FEATURE_KEYWORDS.find(([k]) => hay.includes(k));
  return FEATURE_BY_SLUG[hit ? hit[1] : 'whatsapp-parent-alerts'];
}
