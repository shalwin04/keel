import { PageHeader } from "../components/ui.tsx";
import { ConnectAccounts } from "./Settings.tsx";

/** Where Facebook sign-in lands: pick the ad accounts Keel should watch. */
export function Onboarding() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Choose what Keel watches" subtitle="Pick the ad accounts to protect. Keel locks each ad's current settings as the approved baseline, then checks on a schedule." />
      <ConnectAccounts highlight />
    </div>
  );
}
