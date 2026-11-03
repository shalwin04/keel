import { createAutopilot } from "./autopilot.ts";
import { createMemory } from "./memory.ts";
import type { createRuntime } from "./runtime.ts";
import { fakeStudioModels, metaStudioModels } from "./studio/models.ts";
import { createStudio } from "./studio/pipeline.ts";

type Runtime = Awaited<ReturnType<typeof createRuntime>>;

/** Studio and Autopilot wired to the runtime. STUDIO_FAKE_MODELS=1 swaps Meta's models for deterministic stand-ins. */
export function createMarketing(rt: Runtime) {
  const models = process.env.STUDIO_FAKE_MODELS === "1" ? fakeStudioModels() : metaStudioModels();
  const memory = createMemory({ db: rt.db, models, audit: rt.audit, adsFor: rt.adsFor });
  const studio = createStudio({ db: rt.db, models, audit: rt.audit, adsFor: rt.adsFor, memory });
  const autopilot = createAutopilot({ db: rt.db, models, studio, audit: rt.audit, adsFor: rt.adsFor, memory });
  return { models, studio, autopilot, memory };
}
