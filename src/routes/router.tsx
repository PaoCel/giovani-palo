import { createBrowserRouter, Navigate } from "react-router-dom";

import { AdminLayout } from "@/layouts/AdminLayout";
import { PublicLayout } from "@/layouts/PublicLayout";
import { UnitLeaderLayout } from "@/layouts/UnitLeaderLayout";
import { UserLayout } from "@/layouts/UserLayout";
import { AdminCalendarPage } from "@/pages/admin/AdminCalendarPage";
import { AdminDashboardPage } from "@/pages/admin/AdminDashboardPage";
import { AdminEventDetailPage } from "@/pages/admin/AdminEventDetailPage";
import { AdminEventsPage } from "@/pages/admin/AdminEventsPage";
import { AdminFeedPage } from "@/pages/admin/AdminFeedPage";
import { AdminGalleriesPage } from "@/pages/admin/AdminGalleriesPage";
import { AdminGalleryDetailPage } from "@/pages/admin/AdminGalleryDetailPage";
import { AdminSettingsPage } from "@/pages/admin/AdminSettingsPage";
import { AdminStatsPage } from "@/pages/admin/AdminStatsPage";
import { LoginPage } from "@/pages/auth/LoginPage";
import { PasswordResetPage } from "@/pages/auth/PasswordResetPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { MeDashboardPage } from "@/pages/me/MeDashboardPage";
import { MyActivitiesPage } from "@/pages/me/MyActivitiesPage";
import { MyActivityDetailPage } from "@/pages/me/MyActivityDetailPage";
import { MyActivityEditPage } from "@/pages/me/MyActivityEditPage";
import { MyCalendarPage } from "@/pages/me/MyCalendarPage";
import { MyProfilePage } from "@/pages/me/MyProfilePage";
import { SurveyAnswerPage } from "@/pages/me/SurveyAnswerPage";
import { SurveyHubPage } from "@/pages/me/SurveyHubPage";
import { ActivitiesPage } from "@/pages/public/ActivitiesPage";
import { ActivityDetailPage } from "@/pages/public/ActivityDetailPage";
import { ActivityRegisterPage } from "@/pages/public/ActivityRegisterPage";
import { HomePage } from "@/pages/public/HomePage";
import { ParentConfirmPage } from "@/pages/public/ParentConfirmPage";
import { PhotoConsentPage } from "@/pages/public/PhotoConsentPage";
import { PrivacyPage } from "@/pages/public/PrivacyPage";
import { UnitActivityPage } from "@/pages/unit/UnitActivityPage";
import { UnitDashboardPage } from "@/pages/unit/UnitDashboardPage";
import { AdminRoute, ProtectedRoute, UnitLeaderRoute } from "@/routes/guards";

export const router = createBrowserRouter([
  // Pagina genitore standalone, senza shell pubblico (no nav, no header app).
  // Aperta da magic link Brevo: il genitore non deve essere distratto dal sito.
  { path: "/parent-confirm/:token", element: <ParentConfirmPage /> },
  {
    element: <PublicLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/activities", element: <ActivitiesPage /> },
      { path: "/activities/:eventId", element: <ActivityDetailPage /> },
      { path: "/activities/:eventId/register", element: <ActivityRegisterPage /> },
      { path: "/privacy", element: <PrivacyPage /> },
      { path: "/privacy/photos", element: <PhotoConsentPage /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/password-reset", element: <PasswordResetPage /> },
      { path: "/sondaggi", element: <Navigate replace to="/me/sondaggi" /> },
      { path: "/sondaggi/:eventId", element: <Navigate replace to="/me/sondaggi" /> },
      { path: "/galleria", element: <Navigate replace to="/me" /> },
      { path: "/galleria/:galleryId", element: <Navigate replace to="/me" /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: "/me",
        element: <UserLayout />,
        children: [
          { index: true, element: <MeDashboardPage /> },
          { path: "calendar", element: <MyCalendarPage /> },
          { path: "activities", element: <MyActivitiesPage /> },
          { path: "activities/:eventId", element: <MyActivityDetailPage /> },
          { path: "activities/:eventId/edit", element: <MyActivityEditPage /> },
          { path: "sondaggi", element: <SurveyHubPage /> },
          { path: "sondaggi/:eventId", element: <SurveyAnswerPage /> },
          { path: "profile", element: <MyProfilePage /> },
        ],
      },
    ],
  },
  {
    element: <UnitLeaderRoute />,
    children: [
      {
        path: "/unit",
        element: <UnitLeaderLayout />,
        children: [
          { index: true, element: <UnitDashboardPage /> },
          { path: "activities/:eventId", element: <UnitActivityPage /> },
        ],
      },
    ],
  },
  {
    element: <AdminRoute />,
    children: [
      {
        path: "/admin",
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminDashboardPage /> },
          { path: "calendar", element: <AdminCalendarPage /> },
          { path: "events", element: <AdminEventsPage /> },
          { path: "events/new", element: <AdminEventsPage /> },
          { path: "events/:eventId", element: <AdminEventDetailPage /> },
          { path: "events/:eventId/form-builder", element: <AdminEventDetailPage /> },
          { path: "events/:eventId/registrations", element: <AdminEventDetailPage /> },
          { path: "events/:eventId/consents", element: <AdminEventDetailPage /> },
          { path: "events/:eventId/rooms", element: <AdminEventDetailPage /> },
          { path: "events/:eventId/questions", element: <AdminEventDetailPage /> },
          { path: "events/:eventId/stats", element: <AdminEventDetailPage /> },
          { path: "events/:eventId/surveys", element: <AdminEventDetailPage /> },
          { path: "events/:eventId/sondaggi", element: <AdminEventDetailPage /> },
          { path: "events/:eventId/gallery", element: <AdminEventDetailPage /> },
          { path: "events/:eventId/galleria", element: <AdminEventDetailPage /> },
          { path: "registrations", element: <AdminStatsPage /> },
          { path: "stats", element: <AdminStatsPage /> },
          { path: "feed", element: <AdminFeedPage /> },
          { path: "galleries", element: <AdminGalleriesPage /> },
          { path: "galleries/:galleryId", element: <AdminGalleryDetailPage /> },
          { path: "settings", element: <AdminSettingsPage /> },
        ],
      },
    ],
  },
]);
