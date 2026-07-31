import { Navigate, createBrowserRouter } from "react-router-dom"
import { AppShell } from "@/components/shared/AppShell"
import { ProtectedRoute } from "@/components/shared/ProtectedRoute"
import { ComingSoon } from "@/components/shared/ComingSoon"
import { RoleGuard } from "@/components/shared/RoleGuard"
import { LoginPage } from "@/features/auth/LoginPage"
import { ProfilePage } from "@/features/auth/ProfilePage"
import { DashboardPage } from "@/features/dashboard/DashboardPage"
import { EmployeeListPage } from "@/features/employees/EmployeeListPage"
import { EmployeeProfilePage } from "@/features/employees/EmployeeProfilePage"
import { AttendancePage } from "@/features/attendance/AttendancePage"
import { LeavesPage } from "@/features/leaves/LeavesPage"
import { ProjectListPage } from "@/features/projects/ProjectListPage"
import { ProjectDetailPage } from "@/features/projects/ProjectDetailPage"
import { TaskListPage } from "@/features/tasks/TaskListPage"
import { AssetListPage } from "@/features/assets/AssetListPage"
import { CandidateListPage } from "@/features/recruitment/CandidateListPage"
import { PayrollPage } from "@/features/payroll/PayrollPage"
import { DocumentsPage } from "@/features/documents/DocumentsPage"
import { CalendarPage } from "@/features/calendar/CalendarPage"
import { AnnouncementsPage } from "@/features/announcements/AnnouncementsPage"
import { ReportsPage } from "@/features/reports/ReportsPage"
import { SettingsPage } from "@/features/settings/SettingsPage"
import { navItems } from "@/app/nav-config"

const placeholderRoutes = navItems
  .filter((item) => !item.implemented)
  .map((item) => ({
    path: item.path.slice(1),
    element: <ComingSoon title={item.label} />,
  }))

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/", element: <Navigate to="/dashboard" replace /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: "dashboard", element: <DashboardPage /> },
          { path: "employees", element: <EmployeeListPage /> },
          { path: "employees/:id", element: <EmployeeProfilePage /> },
          { path: "attendance", element: <AttendancePage /> },
          { path: "leaves", element: <LeavesPage /> },
          { path: "projects", element: <ProjectListPage /> },
          { path: "projects/:id", element: <ProjectDetailPage /> },
          { path: "tasks", element: <TaskListPage /> },
          { path: "assets", element: <AssetListPage /> },
          { path: "payroll", element: <PayrollPage /> },
          {
            path: "recruitment",
            element: (
              <RoleGuard roles={["founder", "hr_admin"]}>
                <CandidateListPage />
              </RoleGuard>
            ),
          },
          { path: "documents", element: <DocumentsPage /> },
          { path: "calendar", element: <CalendarPage /> },
          { path: "announcements", element: <AnnouncementsPage /> },
          {
            path: "reports",
            element: (
              <RoleGuard roles={["founder", "hr_admin"]}>
                <ReportsPage />
              </RoleGuard>
            ),
          },
          {
            path: "settings",
            element: (
              <RoleGuard roles={["founder", "hr_admin"]}>
                <SettingsPage />
              </RoleGuard>
            ),
          },
          { path: "profile", element: <ProfilePage /> },
          ...placeholderRoutes,
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/dashboard" replace /> },
])
