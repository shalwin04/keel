# Keel privacy policy

_Last updated: 1 November 2026_

Keel is a tool that watches a business's Meta ad accounts for changes made by Meta's AI creative enhancements and, only with a person's approval, corrects them.

## What Keel accesses

When you sign in with Facebook Login for Business and choose ad accounts, Keel receives an access token with the `ads_read`, `ads_management` and `business_management` permissions. With it, Keel reads, for the ad accounts you select:

- ads, ad creatives and their Advantage+ creative enhancement settings,
- ad preview images,
- the images in the ad account's library that those ads use.

Keel also stores your name and Facebook user ID to identify your account in Keel.

## What Keel does with it

- Compares each ad with the version you approved and with your brand rules, using AI models (Meta's Model API and an open-weight model host).
- Shows findings to the people in your Keel workspace.
- After a person approves, changes the ad through the Marketing API (for example, switching an enhancement off or pausing the ad) and reads it back to confirm.

Keel does not sell data, does not use it for advertising, and does not share it with anyone outside your workspace except the model providers that process images for a check.

## Storage and security

Access tokens are encrypted at rest (AES-256-GCM). Every decision and change is recorded in a tamper-evident audit log. Data is kept while your workspace is active.

## Deleting your data

Disconnect Keel in Facebook settings (Settings & privacy → Business integrations), or ask us to delete your data: open an issue at the project's GitHub repository or email the address on the Meta app listing. We delete your account, tokens and stored ad snapshots within 30 days.
