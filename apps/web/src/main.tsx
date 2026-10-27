import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./components/Shell.tsx";
import { Accounts } from "./pages/Accounts.tsx";
import { Audit } from "./pages/Audit.tsx";
import { Login } from "./pages/Login.tsx";
import { Onboarding } from "./pages/Onboarding.tsx";
import { Review } from "./pages/Review.tsx";
import { Trace } from "./pages/Trace.tsx";
import "./index.css";

const rootRoute = createRootRoute();
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: Login });
const shellRoute = createRoute({ getParentRoute: () => rootRoute, id: "shell", component: Shell });
const reviewRoute = createRoute({ getParentRoute: () => shellRoute, path: "/", component: () => <Review /> });
const reviewItemRoute = createRoute({
  getParentRoute: () => shellRoute, path: "/review/$id",
  component: function ReviewItem() { const { id } = reviewItemRoute.useParams(); return <Review selectedId={id} />; },
});
const traceRoute = createRoute({
  getParentRoute: () => shellRoute, path: "/trace",
  validateSearch: (s: Record<string, unknown>): { cycle?: string } => ({ cycle: typeof s.cycle === "string" ? s.cycle : undefined }),
  component: function TracePage() { const { cycle } = traceRoute.useSearch(); return <Trace key={cycle} cycleId={cycle} />; },
});
const accountsRoute = createRoute({ getParentRoute: () => shellRoute, path: "/accounts", component: Accounts });
const auditRoute = createRoute({ getParentRoute: () => shellRoute, path: "/audit", component: Audit });
const onboardingRoute = createRoute({ getParentRoute: () => shellRoute, path: "/onboarding", component: Onboarding });

const router = createRouter({
  routeTree: rootRoute.addChildren([loginRoute, shellRoute.addChildren([reviewRoute, reviewItemRoute, traceRoute, accountsRoute, auditRoute, onboardingRoute])]),
});
declare module "@tanstack/react-router" { interface Register { router: typeof router } }

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
