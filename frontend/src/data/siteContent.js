// Shared public-site copy: pricing facts and the FAQ.
// The visible FAQ, the FAQPage JSON-LD and llms.txt must say the same thing,
// so every one of them reads from here.
//
// Pricing = the plans the billing code actually sells (backend/models/schema.sql:
// plans 'core' and 'ai', per_student_yearly_paise 40000 / 65000). Change the
// numbers here AND in Super Admin → Plans together.

export const PRICING = {
  currency: 'INR',
  period: 'year',
  gstNote: 'plus GST',
  updated: '21 November 2026',
  plans: [
    {
      code: 'core',
      name: 'Waynur Core',
      price: 400,
      bestFor: 'Schools that want the full school system and WhatsApp updates, without AI features',
      features: [
        'WhatsApp updates to parents from the school’s own number',
        'Attendance, homework, marks, report cards and certificates',
        'Fees with WhatsApp reminders and payment links',
        'Payroll, transport and bus tracking',
        'Admissions, timetable and teacher substitutions',
        'Principal, teacher, accountant, student and parent access',
      ],
    },
    {
      code: 'ai',
      name: 'Waynur AI',
      price: 650,
      highlight: true,
      bestFor: 'Schools that also want the AI tutor and AI help for teachers and the office',
      features: [
        'Everything in Waynur Core',
        'AI tutor for every student that guides instead of giving answers',
        'AI-assisted grading and AI test generator',
        'Ask AI assistant for the principal and teachers',
        'AI replies in the WhatsApp parent and admission assistants',
        'Weekly early warnings and progress notes for parents',
      ],
    },
  ],
};

export const PRICE_SENTENCE =
  'Waynur is priced per student per year and billed to the school; parents never pay. Waynur Core costs ₹400 per student per year and Waynur AI costs ₹650 per student per year, plus GST.';

export const FAQ_GROUPS = [
  {
    title: 'About Waynur',
    items: [
      { q: 'What is Waynur?', a: 'Waynur is AI school management software for private schools in India, built around WhatsApp. It handles attendance, fees, exam results, admission enquiries, substitutions and an AI tutor, and sends updates to parents on WhatsApp.' },
      { q: 'How much does Waynur cost?', a: 'Waynur is priced per student and billed to the school. Waynur Core costs ₹400 per student per year and Waynur AI costs ₹650 per student per year, plus GST. Parents never pay.' },
      { q: 'Who makes Waynur?', a: 'Waynur is made by Wayne E Solutions in Ludhiana, Punjab, India.' },
    ],
  },
  {
    title: 'Getting started',
    items: [
      { q: 'How fast can a school go live?', a: 'Most schools are onboarded within a week, including staff training and data setup.' },
      { q: 'Can we migrate from our current system?', a: 'Yes. Bring your existing student, staff and fee records (spreadsheets or exports from another system) and we help import them.' },
      { q: 'Do we need to buy new hardware?', a: 'No new hardware is required to start. If you want biometric attendance, we help you pick compatible devices during onboarding.' },
      { q: 'How do we book a demo?', a: 'Use the demo form on waynur.com or write to info@waynur.com.' },
    ],
  },
  {
    title: 'For parents and students',
    items: [
      { q: 'Do parents need to install an app?', a: 'No. Parents get updates on WhatsApp from the school’s own number.' },
      { q: 'Whose WhatsApp number sends the messages?', a: 'The school’s own WhatsApp number, so parents recognise it.' },
      { q: 'What does the AI tutor do?', a: 'It helps students work through problems step by step with hints, instead of giving the final answer.' },
      { q: 'Is the AI tutor a replacement for teachers?', a: 'No. It is a learning aid; teachers stay in charge of teaching and grading.' },
    ],
  },
  {
    title: 'Fees, data and ownership',
    items: [
      { q: 'Where do fee payments go?', a: 'Straight into the school’s own account through the payment link. Waynur never holds school fees.' },
      { q: 'Is student data safe?', a: 'Data is hosted in India, with role-based access and audit logs, and handled under the DPDP Act 2023.' },
      { q: 'Who owns the data?', a: 'The school does, always. You can request a full export of your data at any time.' },
      { q: 'What happens if we decide to leave?', a: 'You get a full export of your records. See our Refund and Cancellation Policy for the exact timelines.' },
      { q: 'Who do we contact for a grievance?', a: 'Our Grievance Officer details are listed on the Legal page, along with response timelines.' },
    ],
  },
];

export const ALL_FAQS = FAQ_GROUPS.flatMap((g) => g.items);

export const HOME_INTRO =
  'Waynur is AI-powered school management software for private schools across India, built around WhatsApp. It sends attendance, homework, exam result and fee updates to parents on the school’s own WhatsApp number, helps the office answer admission enquiries, arranges teacher substitutions, and gives every student an AI tutor that guides instead of giving answers. Waynur is made by Wayne E Solutions in Ludhiana, Punjab.';

export const PRICING_FAQS = [
  { q: 'How is pricing calculated?', a: 'Per student per year, billed to the school. No parent, teacher or student ever pays anything directly.' },
  { q: 'Is there a setup fee?', a: "Onboarding and data migration are quoted per school, based on your current records and how many systems we're replacing." },
  { q: 'Can we move from Core to AI later?', a: 'Yes. An upgrade takes effect straight away and you pay only the difference for the rest of the year.' },
  { q: 'Can we try it first?', a: 'Yes. Every school starts with a free walkthrough, and we can set up a free demo period on the AI plan.' },
];

export const BLOG_META = {
  title: 'School Management Guides for Indian Schools | Waynur Blog',
  description: 'Practical guides on admissions, fees, attendance, exams and parent communication for school principals and owners in India.',
  h1: 'The Waynur blog',
};
