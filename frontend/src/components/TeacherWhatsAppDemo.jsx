import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCheck } from 'lucide-react';

function AutoPostCaption({ text, small }) {
  return (
    <div className="flex justify-center">
      <div className={`inline-flex items-center gap-2 rounded-full bg-terracotta/10 text-terracotta border border-terracotta/20 text-center ${small ? 'px-2.5 py-1 text-[10px]' : 'px-3 py-1.5 text-[11px]'} font-medium`}>
        {!small && <span className="h-1.5 w-1.5 rounded-full bg-terracotta shrink-0" />}
        {text}
      </div>
    </div>
  );
}

function AiMessage({ children, time }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] rounded-2xl rounded-tl-md bg-white p-2.5 shadow-sm">
        {children}
        <p className="mt-1.5 text-right text-[11px] text-[#667781]">{time}</p>
      </div>
    </div>
  );
}

function TeacherMessage({ children, time, read }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[70%] rounded-2xl rounded-tr-md bg-[#d9fdd3] p-2.5 px-3 shadow-sm">
        <p className="text-[15px] leading-snug text-[#111b21]">{children}</p>
        <div className="mt-1 flex items-center justify-end gap-1">
          <span className="text-[11px] text-[#667781]">{time}</span>
          {read && <CheckCheck className="h-3.5 w-3.5 text-[#53bdeb]" />}
        </div>
      </div>
    </div>
  );
}

function PhoneMockup() {
  return (
    <div className="relative rounded-[2.75rem] bg-ink p-2 shadow-2xl ring-1 ring-black/10">
      <div className="absolute top-4 left-1/2 -translate-x-1/2 h-6 w-28 rounded-full bg-ink z-20" />
      <div className="relative overflow-hidden rounded-[2.25rem] bg-[#efeae2] h-[1020px] flex flex-col">
        <div className="shrink-0 bg-[#075E54] text-white pt-10 pb-3 px-4 flex items-center gap-3 z-10">
          <div className="h-9 w-9 rounded-full bg-white/20 grid place-items-center text-sm font-semibold">W</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">Waynur AI</p>
            <p className="text-[11px] text-white/70 truncate">Teacher demo</p>
          </div>
        </div>

        <div
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.04'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")` }}
        />

        <div className="relative flex-1 overflow-y-auto px-3 py-4 space-y-3">
          <AutoPostCaption text="Auto-posts if no reply — teacher only steps in to change something" />

          <AiMessage time="8:02 AM">
            <p className="text-[15px] leading-snug">
              Good morning, Anjali ma'am. Here's today's lesson plan for <strong>Class 8B — Mathematics (Linear Equations)</strong>:
            </p>
            <ul className="mt-2 space-y-1 text-[14px] leading-snug pl-1">
              <li>• Recap: What is a variable? (5 min)</li>
              <li>• Live example: 2x + 4 = 10 on the board</li>
              <li>• Group activity: Solve 3 simple equations</li>
              <li>• Wrap-up: One real-life use of linear equations</li>
            </ul>
          </AiMessage>

          <TeacherMessage time="8:04 AM" read>ok</TeacherMessage>
          <AutoPostCaption text="Auto-posted" small />

          <AiMessage time="8:05 AM">
            <p className="text-[15px] leading-snug">Homework draft based on today's lesson — 5 questions:</p>
            <ol className="mt-2 space-y-1.5 text-[14px] leading-snug pl-1">
              <li>1. Solve: 3x + 5 = 14</li>
              <li>2. Solve: 2(x − 3) = 8</li>
              <li>3. If 5 apples cost ₹40, find the cost of 1 apple using an equation.</li>
              <li>4. Form an equation: Twice a number plus 7 equals 19.</li>
              <li>5. Verify if x = 4 is the solution of 2x + 1 = 9.</li>
            </ol>
          </AiMessage>

          <TeacherMessage time="8:06 AM" read>ok</TeacherMessage>

          <AiMessage time="9:47 AM">
            <p className="text-[15px] leading-snug"><strong>Grading summary — Class 8B Maths test</strong></p>
            <div className="mt-1.5 space-y-1 text-[13px] leading-snug">
              <p>📊 Average score: <strong>72%</strong></p>
              <p>⚠️ Struggling students: 3 flagged for review</p>
              <p>📝 Common mistake: Forgetting to divide both sides by the coefficient of x.</p>
            </div>
            <p className="mt-1.5 text-[12px] text-[#667781]">Shared with parents. No action needed.</p>
          </AiMessage>
        </div>

        <div className="shrink-0 bg-[#f0f2f5] px-3 py-2 flex items-center gap-2 z-10">
          <div className="flex-1 rounded-full bg-white px-4 py-2 text-sm text-[#667781]">Message</div>
        </div>
      </div>
    </div>
  );
}

export default function TeacherWhatsAppDemo() {
  return (
    <div className="min-h-screen bg-cream text-ink font-sans">
      <div className="mx-auto max-w-3xl px-6 py-12 md:py-16 flex flex-col items-center">
        <Link to="/" className="self-start inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink transition mb-10">
          <ArrowLeft className="h-4 w-4" /> Back to Waynur
        </Link>
        <div className="text-center max-w-xl">
          <p className="text-xs uppercase tracking-widest text-terracotta font-semibold">See it in action</p>
          <h1 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight text-ink">
            Teachers approve with one word. AI does the rest.
          </h1>
        </div>
        <div className="mt-12 w-full max-w-[360px]">
          <PhoneMockup />
        </div>
        <p className="mt-10 text-center text-sm text-ink-soft max-w-md">
          No new app to learn. Teachers stay on WhatsApp while Waynur drafts, tracks and shares — only asking when a human decision is needed.
        </p>
      </div>
    </div>
  );
}
