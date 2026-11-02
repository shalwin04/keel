import { createMarketing, createRuntime, dueAccounts, sweep } from "@keel/agents";

/**
 * The scheduler. Every minute: expire overdue approvals, then start a cycle for each account whose
 * interval has passed. `--once` runs every watched account once (or just the one given) and exits.
 *
 *   npm run cycle:once                 # all accounts
 *   npm run cycle:once -- act_123      # one account
 */
const once = process.argv.includes("--once");
const only = process.argv.find((a) => a.startsWith("act_"));
const tickMs = Number(process.env.SCHEDULER_TICK_SEC ?? 60) * 1000;
const maxParallel = Number(process.env.MAX_PARALLEL_CYCLES ?? 2);

const rt = await createRuntime();
const { autopilot } = createMarketing(rt);
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), svc: "keel-worker", msg, ...extra }));

async function runOne(accountId: string) {
  const started = Date.now();
  try {
    const cycleId = await rt.runCycle(accountId);
    log("cycle done", { accountId, cycleId, ms: Date.now() - started });
  } catch (err) {
    log("cycle failed", { accountId, error: String((err as Error).message ?? err) });
    await rt.audit("keel", "cycle.error", { accountId, message: String((err as Error).message ?? err) }).catch(() => {});
  }
}

async function runAll(ids: string[]) {
  for (let i = 0; i < ids.length; i += maxParallel) await Promise.all(ids.slice(i, i + maxParallel).map(runOne));
}

if (once) {
  await sweep(rt);
  const ids = only ? [only] : await dueAccounts(rt, new Date(8.64e15));
  if (!ids.length) log("no accounts to check (run `npm run account:add` or connect one in Keel Bridge)");
  await runAll(ids);
  await rt.close();
} else {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const { expired } = await sweep(rt);
      if (expired) log("approvals expired", { count: expired });
      await runAll(only ? [only] : await dueAccounts(rt));
      // Autopilot: read results and propose moves for campaigns whose check is due.
      for (const id of await autopilot.due()) {
        await autopilot.check(id).catch((err) => log("autopilot check failed", { id, error: String(err) }));
        log("autopilot checked", { id });
      }
    } catch (err) {
      const cause = (err as { cause?: { message?: string } }).cause?.message;
      log("tick failed", { error: String(err).split("\nparams")[0], cause, hint: cause && /does not exist/.test(cause) ? "run `npm run db:migrate`" : undefined });
    } finally {
      busy = false;
    }
  };
  log("scheduler started", { tickSec: tickMs / 1000, maxParallel });
  await tick();
  const timer = setInterval(tick, tickMs);
  const stop = async () => { clearInterval(timer); log("shutting down"); await rt.close(); process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
