import { Suspense, lazy, type ComponentType, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";

import { AppLoader } from "@/components/AppLoader";
import { RouteErrorPanel } from "@/components/RouteErrorPanel";
import { AdminLayout } from "@/layouts/AdminLayout";
import { FamilyLayout } from "@/layouts/FamilyLayout";
import { PublicLayout } from "@/layouts/PublicLayout";
import { UnitLeaderLayout } from "@/layouts/UnitLeaderLayout";
import { UserLayout } from "@/layouts/UserLayout";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { ActivitiesPage } from "@/pages/public/ActivitiesPage";
import { ActivityDetailPage } from "@/pages/public/ActivityDetailPage";
import { HomePage } from "@/pages/public/HomePage";
import { LoginPage } from "@/pages/auth/LoginPage";
import { AdminRoute, CampRoute, ParentRoute, ProtectedRoute, UnitLeaderRoute } from "@/routes/guards";

// Le pagine pubbliche "calde" (home, lista attività, dettaglio, login)
// restano nel bundle principale per il primo paint istantaneo. Tutto il
// resto — aree autenticate e flussi secondari — viene caricato on demand.
function lazyPage(
  loader: () => Promise<Record<string, unknown>>,
  name: string,
): ReactNode {
  const Component = lazy(async () => {
    const module = await loader();
    return { default: module[name] as ComponentType };
  });

  return (
    <Suspense fallback={<AppLoader />}>
      <Component />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  // Pagina genitore standalone, senza shell pubblico (no nav, no header app).
  // Aperta da magic link Brevo: il genitore non deve essere distratto dal sito.
  {
    path: "/parent-confirm/:token",
    element: lazyPage(() => import("@/pages/public/ParentConfirmPage"), "ParentConfirmPage"),
    errorElement: <RouteErrorPanel />,
  },
  {
    element: <PublicLayout />,
    errorElement: <RouteErrorPanel />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/activities", element: <ActivitiesPage /> },
      { path: "/activities/:eventId", element: <ActivityDetailPage /> },
      {
        path: "/activities/:eventId/register",
        element: lazyPage(
          () => import("@/pages/public/ActivityRegisterPage"),
          "ActivityRegisterPage",
        ),
      },
      {
        path: "/privacy",
        element: lazyPage(() => import("@/pages/public/PrivacyPage"), "PrivacyPage"),
      },
      {
        path: "/privacy/photos",
        element: lazyPage(() => import("@/pages/public/PhotoConsentPage"), "PhotoConsentPage"),
      },
      { path: "/login", element: <LoginPage /> },
      {
        path: "/password-reset",
        element: lazyPage(() => import("@/pages/auth/PasswordResetPage"), "PasswordResetPage"),
      },
      { path: "/sondaggi", element: <Navigate replace to="/me/sondaggi" /> },
      { path: "/sondaggi/:eventId", element: <Navigate replace to="/me/sondaggi" /> },
      { path: "/galleria", element: <Navigate replace to="/me" /> },
      { path: "/galleria/:galleryId", element: <Navigate replace to="/me" /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  {
    element: <ProtectedRoute />,
    errorElement: <RouteErrorPanel />,
    children: [
      {
        path: "/me",
        element: <UserLayout />,
        children: [
          {
            index: true,
            element: lazyPage(() => import("@/pages/me/MeDashboardPage"), "MeDashboardPage"),
          },
          {
            path: "calendar",
            element: lazyPage(() => import("@/pages/me/MyCalendarPage"), "MyCalendarPage"),
          },
          {
            path: "activities",
            element: lazyPage(() => import("@/pages/me/MyActivitiesPage"), "MyActivitiesPage"),
          },
          {
            path: "activities/:eventId",
            element: lazyPage(
              () => import("@/pages/me/MyActivityDetailPage"),
              "MyActivityDetailPage",
            ),
          },
          {
            path: "activities/:eventId/edit",
            element: lazyPage(
              () => import("@/pages/me/MyActivityEditPage"),
              "MyActivityEditPage",
            ),
          },
          {
            path: "galleria/per-attivita/:eventId",
            element: lazyPage(
              () => import("@/pages/me/MyActivityGalleryPage"),
              "MyActivityGalleryPage",
            ),
          },
          {
            path: "sondaggi",
            element: lazyPage(() => import("@/pages/me/SurveyHubPage"), "SurveyHubPage"),
          },
          {
            path: "sondaggi/:eventId",
            element: lazyPage(() => import("@/pages/me/SurveyAnswerPage"), "SurveyAnswerPage"),
          },
          {
            path: "profile",
            element: lazyPage(() => import("@/pages/me/MyProfilePage"), "MyProfilePage"),
          },
        ],
      },
    ],
  },
  {
    // Area campeggio condivisa: raggiungibile da tutti i ruoli autenticati.
    element: <CampRoute />,
    errorElement: <RouteErrorPanel />,
    children: [
      {
        path: "/campeggio",
        element: lazyPage(() => import("@/pages/camp/CampIndexPage"), "CampIndexPage"),
      },
      {
        path: "/campeggio/:eventId",
        element: lazyPage(() => import("@/pages/camp/CampHubPage"), "CampHubPage"),
      },
    ],
  },
  {
    element: <ParentRoute />,
    errorElement: <RouteErrorPanel />,
    children: [
      {
        path: "/family",
        element: <FamilyLayout />,
        children: [
          {
            index: true,
            element: lazyPage(
              () => import("@/pages/family/FamilyDashboardPage"),
              "FamilyDashboardPage",
            ),
          },
          { path: "activities", element: <Navigate replace to="/activities" /> },
          {
            path: "profile",
            element: lazyPage(
              () => import("@/pages/family/FamilyProfilePage"),
              "FamilyProfilePage",
            ),
          },
        ],
      },
    ],
  },
  {
    element: <UnitLeaderRoute />,
    errorElement: <RouteErrorPanel />,
    children: [
      {
        path: "/unit",
        element: <UnitLeaderLayout />,
        children: [
          {
            index: true,
            element: lazyPage(
              () => import("@/pages/unit/UnitDashboardPage"),
              "UnitDashboardPage",
            ),
          },
          {
            path: "activities/:eventId",
            element: lazyPage(() => import("@/pages/unit/UnitActivityPage"), "UnitActivityPage"),
          },
        ],
      },
    ],
  },
  {
    element: <AdminRoute />,
    errorElement: <RouteErrorPanel />,
    children: [
      {
        path: "/admin",
        element: <AdminLayout />,
        children: [
          {
            index: true,
            element: lazyPage(
              () => import("@/pages/admin/AdminDashboardPage"),
              "AdminDashboardPage",
            ),
          },
          {
            path: "calendar",
            element: lazyPage(
              () => import("@/pages/admin/AdminCalendarPage"),
              "AdminCalendarPage",
            ),
          },
          {
            path: "events",
            element: lazyPage(() => import("@/pages/admin/AdminEventsPage"), "AdminEventsPage"),
          },
          {
            path: "events/new",
            element: lazyPage(() => import("@/pages/admin/AdminEventsPage"), "AdminEventsPage"),
          },
          ...[
            "events/:eventId",
            "events/:eventId/form-builder",
            "events/:eventId/committees",
            "events/:eventId/comitati",
            "events/:eventId/registrations",
            "events/:eventId/consents",
            "events/:eventId/rooms",
            "events/:eventId/questions",
            "events/:eventId/stats",
            "events/:eventId/surveys",
            "events/:eventId/sondaggi",
            "events/:eventId/gallery",
            "events/:eventId/galleria",
          ].map((path) => ({
            path,
            element: lazyPage(
              () => import("@/pages/admin/AdminEventDetailPage"),
              "AdminEventDetailPage",
            ),
          })),
          {
            path: "registrations",
            element: lazyPage(() => import("@/pages/admin/AdminStatsPage"), "AdminStatsPage"),
          },
          {
            path: "stats",
            element: lazyPage(() => import("@/pages/admin/AdminStatsPage"), "AdminStatsPage"),
          },
          {
            path: "feed",
            element: lazyPage(() => import("@/pages/admin/AdminFeedPage"), "AdminFeedPage"),
          },
          {
            path: "galleries",
            element: lazyPage(
              () => import("@/pages/admin/AdminGalleriesPage"),
              "AdminGalleriesPage",
            ),
          },
          {
            path: "galleries/:galleryId",
            element: lazyPage(
              () => import("@/pages/admin/AdminGalleryDetailPage"),
              "AdminGalleryDetailPage",
            ),
          },
          {
            path: "settings",
            element: lazyPage(
              () => import("@/pages/admin/AdminSettingsPage"),
              "AdminSettingsPage",
            ),
          },
        ],
      },
    ],
  },
]);
