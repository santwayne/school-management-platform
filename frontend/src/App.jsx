import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './components/Login';
const TeacherPortal = lazy(() => import('./components/TeacherPortal'));
const PrincipalDashboard = lazy(() => import('./components/PrincipalDashboard'));
const AdminHome = lazy(() => import('./components/AdminHome'));
const AccountantHome = lazy(() => import('./components/AccountantHome'));
const SuperAdminHome = lazy(() => import('./components/SuperAdminHome'));
const AIGrading = lazy(() => import('./components/AIGrading'));
const SuperAdminLogin = lazy(() => import('./components/SuperAdminLogin'));
const SuperAdminDashboard = lazy(() => import('./components/SuperAdminDashboard'));
const ClassManager = lazy(() => import('./components/ClassManager'));
const SyllabusManager = lazy(() => import('./components/SyllabusManager'));
const ManageSchool = lazy(() => import('./components/ManageSchool'));
const Onboarding = lazy(() => import('./components/Onboarding'));
import Index from './components/Index';
const Team = lazy(() => import('./components/Team'));
const Legal = lazy(() => import('./components/Legal'));
const Features = lazy(() => import('./components/Features'));
const Pricing = lazy(() => import('./components/Pricing'));
const Faq = lazy(() => import('./components/Faq'));
const BlogIndex = lazy(() => import('./components/blog/BlogIndex'));
const BlogPost = lazy(() => import('./components/blog/BlogPost'));
const BlogAdmin = lazy(() => import('./components/blog/BlogAdmin'));
const TeacherWhatsAppDemo = lazy(() => import('./components/TeacherWhatsAppDemo'));
const SuperAdminBilling = lazy(() => import('./components/SuperAdminBilling'));
const AdminAttendance = lazy(() => import('./components/AdminAttendance'));
const AdminStudentAttendance = lazy(() => import('./components/AdminStudentAttendance'));
const ClassNotesComposer = lazy(() => import('./components/ClassNotesComposer'));
const StaffBroadcast = lazy(() => import('./components/StaffBroadcast'));
const AdminPayroll = lazy(() => import('./components/AdminPayroll'));
const AdminTransport = lazy(() => import('./components/AdminTransport'));
const StudentTutor = lazy(() => import('./components/StudentTutor'));
const StudentHome = lazy(() => import('./components/StudentHome'));
const AdminReports = lazy(() => import('./components/AdminReports'));
const AdminSettings = lazy(() => import('./components/AdminSettings'));
const AdminCommunications = lazy(() => import('./components/AdminCommunications'));
const AdminMessages = lazy(() => import('./components/AdminMessages'));
const AdminBilling = lazy(() => import('./components/AdminBilling'));
const FeeCollectionHub = lazy(() => import('./components/FeeCollectionHub'));
const StudentHomework = lazy(() => import('./components/StudentHomework'));
const StudentNotes = lazy(() => import('./components/StudentNotes'));
const StudentProgress = lazy(() => import('./components/StudentProgress'));
const StudentResults = lazy(() => import('./components/StudentResults'));
const StudentRewards = lazy(() => import('./components/StudentRewards'));
const StudentLibrary = lazy(() => import('./components/StudentLibrary'));
import AdminShell from './components/AdminShell';
import AccountantShell from './components/AccountantShell';
import SuperAdminShell from './components/SuperAdminShell';
import OperatorShell from './components/OperatorShell';
const OpsOverview = lazy(() => import('./components/ops/OpsOverview'));
const ExceptionInbox = lazy(() => import('./components/ops/ExceptionInbox'));
const AutomationsList = lazy(() => import('./components/ops/Automations').then((m) => ({ default: m.AutomationsList })));
const AutomationDetail = lazy(() => import('./components/ops/Automations').then((m) => ({ default: m.AutomationDetail })));
const AuditLog = lazy(() => import('./components/ops/AuditLog'));
const OpsSettings = lazy(() => import('./components/ops/OpsSettings'));
const AdminStaffLeave = lazy(() => import('./components/AdminStaffLeave'));
const TeacherLeave = lazy(() => import('./components/TeacherLeave'));
const MyPayslips = lazy(() => import('./components/MyPayslips'));
const AdminTimetable = lazy(() => import('./components/AdminTimetable'));
const TeacherLessonPlans = lazy(() => import('./components/TeacherLessonPlans'));
const TeacherHomework = lazy(() => import('./components/TeacherHomework'));
const AdminLessonPlans = lazy(() => import('./components/AdminLessonPlans'));
const AdminEventCalendar = lazy(() => import('./components/AdminEventCalendar'));
const AdminLibrary = lazy(() => import('./components/AdminLibrary'));
const TransportPayouts = lazy(() => import('./components/TransportPayouts'));
const AdminActivities = lazy(() => import('./components/AdminActivities'));
const StudentActivities = lazy(() => import('./components/StudentActivities'));
const SuperAdminAiVoiceTutor = lazy(() => import('./components/SuperAdminAiVoiceTutor'));
const StudentProfile = lazy(() => import('./components/StudentProfile'));
const AdminOptionalSubjects = lazy(() => import('./components/AdminOptionalSubjects'));
const AdminStudentLeave = lazy(() => import('./components/AdminStudentLeave'));
const StudentLeave = lazy(() => import('./components/StudentLeave'));
const AdmissionsPipeline = lazy(() => import('./components/admissions/AdmissionsPipeline'));
const EnquiryDetail = lazy(() => import('./components/admissions/EnquiryDetail'));
const VisitSlots = lazy(() => import('./components/admissions/VisitSlots'));
const AdmissionSettings = lazy(() => import('./components/admissions/AdmissionSettings'));
const PublicAdmissionEnquiry = lazy(() => import('./components/PublicAdmissionEnquiry'));
const ParentMessages = lazy(() => import('./components/parents/ParentMessages'));
const SubstitutionBoard = lazy(() => import('./components/staff/SubstitutionBoard'));
const IssuedCertificates = lazy(() => import('./components/IssuedCertificates'));
const PublicCertificateVerify = lazy(() => import('./components/PublicCertificateVerify'));
const AdminBulkUpload = lazy(() => import('./components/AdminBulkUpload'));
const AdminCertificates = lazy(() => import('./components/AdminCertificates'));
const AdminDocumentRequests = lazy(() => import('./components/AdminDocumentRequests'));
const StudentCertificateRequest = lazy(() => import('./components/StudentCertificateRequest'));
const MarksEntry = lazy(() => import('./components/MarksEntry'));
const ReportCards = lazy(() => import('./components/ReportCards'));
const StudentAttendance = lazy(() => import('./components/StudentAttendance'));

// Every role now has its own sidebar shell (matches the approved Lovable
// designs) — Admin/Accountant/Student/Super Admin pages render inside their
// shell, wrapped once here so individual page components stay shell-agnostic.
// Teacher Portal intentionally has no shell — it's the deliberately minimal
// WhatsApp-first surface, not meant to carry the full sidebar chrome.
//
// Pages are code-split with React.lazy (one chunk per page), so the first load
// only downloads the landing page, login and the shells. The Suspense boundary
// sits inside the shell, so the sidebar stays put while a page chunk loads.
function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-terracotta border-t-transparent" />
    </div>
  );
}

const inShell = (Shell, Page) => (
  <Shell>
    <Suspense fallback={<PageLoader />}>
      <Page />
    </Suspense>
  </Shell>
);

function homeFor(role) {
  if (role === 'student') return '/student';
  if (role === 'super_admin') return '/super-admin';
  if (role === 'accountant') return '/accountant';
  if (role === 'operator') return '/ops';
  if (role === 'librarian') return '/admin/library';
  if (role === 'principal') return '/dashboard';
  return '/teacher';
}

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homeFor(user.role)} replace />;
}

// Accountants get the hub in their own shell; a principal who lands on the
// accountant URL (old bookmark/link) goes to the same hub at /finance instead
// of being bounced to the dashboard.
function FeeCollectionRoute() {
  const { user } = useAuth();
  const { search } = useLocation();
  if (user?.role === 'principal') return <Navigate to={`/finance${search}`} replace />;
  return <ProtectedRoute accountantOnly>{inShell(AccountantShell, FeeCollectionHub)}</ProtectedRoute>;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/team" element={<Team />} />
        <Route path="/legal" element={<Legal />} />
        <Route path="/legal/:sectionId" element={<Legal />} />
        <Route path="/features" element={<Features />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/blog" element={<BlogIndex />} />
        <Route path="/blog/:slug" element={<BlogPost />} />
        {/* Standalone blog panel: own login, no ProtectedRoute / AuthContext / dashboard shell. */}
        <Route path="/blog-admin" element={<BlogAdmin />} />
        <Route path="/demo/teacher-whatsapp" element={<TeacherWhatsAppDemo />} />
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/student-login" element={<Navigate to="/login" replace />} />

        <Route path="/teacher" element={<ProtectedRoute teacherOrPrincipalOnly><TeacherPortal /></ProtectedRoute>} />
        <Route path="/teacher/leave" element={<ProtectedRoute teacherOrPrincipalOnly><TeacherLeave /></ProtectedRoute>} />
        <Route path="/teacher/payslips" element={<ProtectedRoute teacherOrPrincipalOnly><MyPayslips /></ProtectedRoute>} />
        <Route path="/teacher/lesson-plans" element={<ProtectedRoute teacherOrPrincipalOnly><TeacherLessonPlans /></ProtectedRoute>} />
        <Route path="/teacher/homework" element={<ProtectedRoute teacherOrPrincipalOnly><TeacherHomework /></ProtectedRoute>} />

        {/* Operator Control Center — operator and principal */}
        <Route path="/ops" element={<ProtectedRoute operatorOnly>{inShell(OperatorShell, OpsOverview)}</ProtectedRoute>} />
        <Route path="/ops/inbox" element={<ProtectedRoute operatorOnly>{inShell(OperatorShell, ExceptionInbox)}</ProtectedRoute>} />
        <Route path="/ops/automations" element={<ProtectedRoute operatorOnly>{inShell(OperatorShell, AutomationsList)}</ProtectedRoute>} />
        <Route path="/ops/automations/:key" element={<ProtectedRoute operatorOnly>{inShell(OperatorShell, AutomationDetail)}</ProtectedRoute>} />
        <Route path="/ops/audit" element={<ProtectedRoute operatorOnly>{inShell(OperatorShell, AuditLog)}</ProtectedRoute>} />
        <Route path="/ops/settings" element={<ProtectedRoute operatorOnly>{inShell(OperatorShell, OpsSettings)}</ProtectedRoute>} />
        <Route path="/ops/admissions" element={<ProtectedRoute operatorOnly>{inShell(OperatorShell, AdmissionsPipeline)}</ProtectedRoute>} />
        <Route path="/ops/admissions/slots" element={<ProtectedRoute operatorOnly>{inShell(OperatorShell, VisitSlots)}</ProtectedRoute>} />
        <Route path="/ops/admissions/settings" element={<ProtectedRoute operatorOnly>{inShell(OperatorShell, AdmissionSettings)}</ProtectedRoute>} />
        <Route path="/ops/admissions/:id" element={<ProtectedRoute operatorOnly>{inShell(OperatorShell, EnquiryDetail)}</ProtectedRoute>} />
        <Route path="/ops/parents" element={<ProtectedRoute operatorOnly>{inShell(OperatorShell, ParentMessages)}</ProtectedRoute>} />
        <Route path="/ops/substitutions" element={<ProtectedRoute operatorOnly>{inShell(OperatorShell, SubstitutionBoard)}</ProtectedRoute>} />
        <Route path="/ops/certificates" element={<ProtectedRoute operatorOnly>{inShell(OperatorShell, IssuedCertificates)}</ProtectedRoute>} />
        <Route path="/admissions/:slug" element={<PublicAdmissionEnquiry />} />
        <Route path="/certificates/verify/:code" element={<PublicCertificateVerify />} />
        <Route path="/dashboard" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminHome)}</ProtectedRoute>} />
        <Route path="/dashboard-alerts" element={<ProtectedRoute principalOnly>{inShell(AdminShell, PrincipalDashboard)}</ProtectedRoute>} />
        {/* Principal gets the same Fee Collection hub as the accountant: manual entry, WhatsApp cash-slip queue and online payment links. */}
        <Route path="/finance" element={<ProtectedRoute principalOnly>{inShell(AdminShell, FeeCollectionHub)}</ProtectedRoute>} />
        <Route path="/classes" element={<ProtectedRoute principalOnly>{inShell(AdminShell, ClassManager)}</ProtectedRoute>} />
        <Route path="/syllabus" element={<ProtectedRoute principalOnly>{inShell(AdminShell, SyllabusManager)}</ProtectedRoute>} />
        <Route path="/admin/manage" element={<ProtectedRoute principalOnly>{inShell(AdminShell, ManageSchool)}</ProtectedRoute>} />
        <Route path="/admin/attendance" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminAttendance)}</ProtectedRoute>} />
        <Route path="/admin/student-attendance" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminStudentAttendance)}</ProtectedRoute>} />
        <Route path="/staff-broadcast" element={<ProtectedRoute principalOnly>{inShell(AdminShell, StaffBroadcast)}</ProtectedRoute>} />
        <Route path="/admin/payroll" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminPayroll)}</ProtectedRoute>} />
        <Route path="/admin/transport" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminTransport)}</ProtectedRoute>} />
        <Route path="/admin/settings" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminSettings)}</ProtectedRoute>} />
        <Route path="/admin/communications" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminCommunications)}</ProtectedRoute>} />
        <Route path="/admin/messages" element={<ProtectedRoute teacherOrPrincipalOnly>{inShell(AdminShell, AdminMessages)}</ProtectedRoute>} />
        <Route path="/admin/billing" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminBilling)}</ProtectedRoute>} />
        <Route path="/admin/staff-leave" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminStaffLeave)}</ProtectedRoute>} />
        <Route path="/optional-subjects" element={<ProtectedRoute teacherOrPrincipalOnly>{inShell(AdminShell, AdminOptionalSubjects)}</ProtectedRoute>} />
        <Route path="/student-leave" element={<ProtectedRoute teacherOrPrincipalOnly>{inShell(AdminShell, AdminStudentLeave)}</ProtectedRoute>} />
        <Route path="/admin/timetable" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminTimetable)}</ProtectedRoute>} />
        <Route path="/admin/lesson-plans" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminLessonPlans)}</ProtectedRoute>} />
        <Route path="/admin/events" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminEventCalendar)}</ProtectedRoute>} />
        <Route path="/admin/library" element={<ProtectedRoute libraryOnly>{inShell(AdminShell, AdminLibrary)}</ProtectedRoute>} />
        <Route path="/admin/students/:studentId/profile" element={<ProtectedRoute teacherOrPrincipalOnly>{inShell(AdminShell, StudentProfile)}</ProtectedRoute>} />
        <Route path="/admin/transport/payouts" element={<ProtectedRoute principalOnly>{inShell(AdminShell, TransportPayouts)}</ProtectedRoute>} />
        <Route path="/admin/activities" element={<ProtectedRoute teacherOrPrincipalOnly>{inShell(AdminShell, AdminActivities)}</ProtectedRoute>} />
        <Route path="/admin/students/bulk-upload" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminBulkUpload)}</ProtectedRoute>} />
        <Route path="/admin/certificates" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminCertificates)}</ProtectedRoute>} />
        <Route path="/admin/document-requests" element={<ProtectedRoute principalOnly>{inShell(AdminShell, AdminDocumentRequests)}</ProtectedRoute>} />
        <Route path="/admin/reports" element={<ProtectedRoute financeOnly>{inShell(AdminShell, AdminReports)}</ProtectedRoute>} />
        <Route path="/accountant/reports" element={<ProtectedRoute accountantOnly>{inShell(AccountantShell, AdminReports)}</ProtectedRoute>} />
        <Route path="/grading" element={<ProtectedRoute>{inShell(AdminShell, AIGrading)}</ProtectedRoute>} />
        <Route path="/class-notes" element={<ProtectedRoute teacherOrPrincipalOnly>{inShell(AdminShell, ClassNotesComposer)}</ProtectedRoute>} />
        <Route path="/marks-entry" element={<ProtectedRoute teacherOrPrincipalOnly>{inShell(AdminShell, MarksEntry)}</ProtectedRoute>} />
        <Route path="/report-cards" element={<ProtectedRoute teacherOrPrincipalOnly>{inShell(AdminShell, ReportCards)}</ProtectedRoute>} />

        <Route path="/accountant" element={<ProtectedRoute accountantOnly>{inShell(AccountantShell, AccountantHome)}</ProtectedRoute>} />
        <Route path="/accountant/fee-collection" element={<FeeCollectionRoute />} />
        <Route path="/accountant/payroll" element={<ProtectedRoute accountantOnly>{inShell(AccountantShell, AdminPayroll)}</ProtectedRoute>} />

        <Route path="/student" element={<ProtectedRoute studentOnly><StudentHome /></ProtectedRoute>} />
        <Route path="/tutor" element={<ProtectedRoute studentOnly><StudentTutor /></ProtectedRoute>} />
        <Route path="/homework" element={<ProtectedRoute studentOnly><StudentHomework /></ProtectedRoute>} />
        <Route path="/notes" element={<ProtectedRoute studentOnly><StudentNotes /></ProtectedRoute>} />
        <Route path="/activities" element={<ProtectedRoute studentOnly><StudentActivities /></ProtectedRoute>} />
        <Route path="/progress" element={<ProtectedRoute studentOnly><StudentProgress /></ProtectedRoute>} />
        <Route path="/results" element={<ProtectedRoute studentOnly><StudentResults /></ProtectedRoute>} />
        <Route path="/rewards" element={<ProtectedRoute studentOnly><StudentRewards /></ProtectedRoute>} />
        <Route path="/library" element={<ProtectedRoute studentOnly><StudentLibrary /></ProtectedRoute>} />
        <Route path="/student/leave" element={<ProtectedRoute studentOnly><StudentLeave /></ProtectedRoute>} />
        <Route path="/certificates" element={<ProtectedRoute studentOnly><StudentCertificateRequest /></ProtectedRoute>} />
        <Route path="/attendance" element={<ProtectedRoute studentOnly><StudentAttendance /></ProtectedRoute>} />

        <Route path="/super-admin-login" element={<SuperAdminLogin />} />
        <Route path="/super-admin" element={<ProtectedRoute superAdminOnly>{inShell(SuperAdminShell, SuperAdminHome)}</ProtectedRoute>} />
        <Route path="/super-admin/schools" element={<ProtectedRoute superAdminOnly>{inShell(SuperAdminShell, SuperAdminDashboard)}</ProtectedRoute>} />
        <Route path="/super-admin/billing" element={<ProtectedRoute superAdminOnly>{inShell(SuperAdminShell, SuperAdminBilling)}</ProtectedRoute>} />
        <Route path="/super-admin/ai-voice-tutor" element={<ProtectedRoute superAdminOnly>{inShell(SuperAdminShell, SuperAdminAiVoiceTutor)}</ProtectedRoute>} />

        <Route path="*" element={<HomeRedirect />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-cream">
        <AppRoutes />
      </div>
    </AuthProvider>
  );
}
