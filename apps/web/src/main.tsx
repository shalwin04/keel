import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./components/Shell.tsx";
import { ToastProvider } from "./components/Toast.tsx";
import { Activity } from "./pages/Activity.tsx";
import { Ads } from "./pages/Ads.tsx";
import { Audit } from "./pages/Audit.tsx";
import { Login } from "./pages/Login.tsx";
import { Onboarding } from "./pages/Onboarding.tsx";
import { Review } from "./pages/Review.tsx";
import { Rules } from "./pages/Rules.tsx";
import { Settings } from "./pages/Settings.tsx";
import "./index.css";

const rootRoute = createRootRoute();
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: Login });
const shellRoute = createRoute({ getParentRoute: () => rootRoute, id: "shell", component: Shell });
const reviewRoute = createRoute({ getParentRoute: () => shellRoute, path: "/", component: () => <Review /> });
const reviewItemRoute = createRoute({
  getParentRoute: () => shellRoute, path: "/review/$id",
  component: function ReviewItem() { const { id } = reviewItemRoute.useParams(); return <Review selectedId={id} />; },
});
const activityRoute = createRoute({
  getParentRoute: () => shellRoute, path: "/activity",
  validateSearch: (s: Record<string, unknown>): { cycle?: string } => ({ cycle: typeof s.cycle === "string" ? s.cycle : undefined }),
  component: function ActivityPage() { const { cycle } = activityRoute.useSearch(); return <Activity cycleId={cycle} />; },
});
const adsRoute = createRoute({ getParentRoute: () => shellRoute, path: "/ads", component: Ads });
const rulesRoute = createRoute({ getParentRoute: () => shellRoute, path: "/rules", component: Rules });
const auditRoute = createRoute({ getParentRoute: () => shellRoute, path: "/audit", component: Audit });
const settingsRoute = createRoute({ getParentRoute: () => shellRoute, path: "/settings", component: Settings });
const onboardingRoute = createRoute({ getParentRoute: () => shellRoute, path: "/onboarding", component: Onboarding });
// Old links keep working.
const traceRedirect = createRoute({ getParentRoute: () => rootRoute, path: "/trace", beforeLoad: () => { throw redirect({ to: "/activity" }); } });
const accountsRedirect = createRoute({ getParentRoute: () => rootRoute, path: "/accounts", beforeLoad: () => { throw redirect({ to: "/ads" }); } });

const router = createRouter({
  routeTree: rootRoute.addChildren([
    loginRoute, traceRedirect, accountsRedirect,
    shellRoute.addChildren([reviewRoute, reviewItemRoute, activityRoute, adsRoute, rulesRoute, auditRoute, settingsRoute, onboardingRoute]),
  ]),
  defaultPreload: "intent",
});
declare module "@tanstack/react-router" { interface Register { router: typeof router } }

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: (n, e) => n < 2 && !(e as { status?: number }).status } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
