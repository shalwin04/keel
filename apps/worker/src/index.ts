import { createRuntime } from "@keel/agents";

const once = process.argv.includes("--once");
const accountId = process.env.META_AD_ACCOUNT_ID;
const intervalMin = Number(process.env.POLL_INTERVAL_MIN ?? 180);
if (!accountId) throw new Error("META_AD_ACCOUNT_ID is not set");

const rt = await createRuntime();

async function tick() {
  const started = Date.now();
  try {
    const cycleId = await rt.runCycle(accountId!);
    console.log(`cycle ${cycleId} finished or paused for approval in ${Date.now() - started} ms`);
  } catch (err) {
    console.error("cycle failed", err);
    await rt.audit("keel", "cycle.error", { message: String(err) });
  }
}

await tick();
if (once) await rt.close();
else setInterval(tick, intervalMin * 60_000);
