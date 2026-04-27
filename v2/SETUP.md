# Portfolio Tracker V2.0 — Setup Guide
**Est. time: 20 minutes. After this, fully automated forever.**

---

## Step 1 — Create GitHub Repo (3 min)

1. Go to [github.com/new](https://github.com/new)
2. Name it `kim-portfolio-tracker`
3. Set to **Private**
4. Click **Create repository**
5. Upload this entire `v2/` folder to the repo (drag and drop, or use GitHub Desktop)
6. Note your GitHub username — you'll need it in Step 4

---

## Step 2 — Create Airtable Base (5 min)

1. Go to [airtable.com](https://airtable.com) → **Add a base** → **Start from scratch**
2. Name it `Portfolio Tracker`
3. Create these two tables:

### Table 1: "Daily Positions"
Create these fields (Field type in brackets):

| Field Name | Type |
|---|---|
| Date | Date |
| Position | Single line text |
| Protocol | Single line text |
| Chain | Single line text |
| Type | Single line text |
| Value USD | Number (2 decimal places) |
| Available Margin USD | Number |
| Unrealized PnL USD | Number |
| Realized PnL Daily USD | Number |
| Realized PnL Weekly USD | Number |
| Realized PnL Monthly USD | Number |
| Realized PnL Total USD | Number |
| Daily PnL % | Number (3 decimal places) |
| Weekly PnL % | Number |
| Monthly PnL % | Number |
| Open Positions Count | Number |
| WETH Amount | Number |
| USDC Amount | Number |
| Pending Fees USD | Number |
| In Range | Single line text |
| Tick Lower | Number |
| Tick Upper | Number |
| Current Tick | Number |
| APY Current % | Number |
| APY 30d Avg % | Number |
| Entry Price | Number |
| Mark Price | Number |
| Notes | Long text |

### Table 2: "Briefings"
| Field Name | Type |
|---|---|
| Date | Date |
| Brief Text | Long text |
| Word Count | Number |
| BTC Price | Number |
| ETH Price | Number |
| Audio URL | URL |

4. Get your **Airtable API key**: Profile → Developer Hub → Create token → Scope: `data.records:write`, `data.records:read` → Select your base
5. Get your **Base ID**: Open the base → Help → API documentation → look for `appXXXXXXXXX` in the URL

---

## Step 3 — Add GitHub Secrets (5 min)

In your GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret Name | Value |
|---|---|
| `BLOFIN_API_KEY` | `057682b026b846f68e2d54d46d224965` |
| `BLOFIN_SECRET` | `213ac11fc88b48e4ae2d2aa29f8a4842` |
| `BLOFIN_PASSPHRASE` | `middlearth` |
| `AIRTABLE_API_KEY` | *(from Step 2)* |
| `AIRTABLE_BASE_ID` | *(from Step 2, starts with `app`)* |
| `BASE_RPC_URL` | `https://mainnet.base.org` *(or your Alchemy Base URL)* |
| `ARB_RPC_URL` | `https://arb1.arbitrum.io/rpc` *(or your Alchemy Arb URL)* |
| `ANTHROPIC_API_KEY` | *(your Claude API key from console.anthropic.com)* |
| `ELEVENLABS_API_KEY` | *(from elevenlabs.io → Profile → API Key)* |
| `ELEVENLABS_VOICE_ID` | `21m00Tcm4TlvDq8ikWAM` *(Rachel — or swap for another)* |

Then add a **Variable** (not secret):
- Settings → **Variables** → `DRY_RUN` = `true` ← set this while testing, delete when ready

---

## Step 4 — Set Up cron-job.org (5 min)

> GitHub's built-in cron is unreliable (30min–3hr delays). cron-job.org fires exactly on time.

1. Go to [cron-job.org](https://cron-job.org) → Create account (free)
2. **New cronjob**:
   - URL: `https://api.github.com/repos/YOUR_GITHUB_USERNAME/kim-portfolio-tracker/actions/workflows/daily-portfolio-check.yml/dispatches`
   - Schedule: **19:00 UTC** daily (= 7:00 AM NZST)
   - Method: `POST`
   - Headers: `Authorization: Bearer YOUR_GITHUB_PAT` and `Accept: application/vnd.github.v3+json`
   - Body (JSON): `{"ref":"main"}`

3. **GitHub Personal Access Token** (for the header above):
   - GitHub → Settings → Developer Settings → Personal access tokens → Fine-grained tokens
   - Permissions: `Actions: Write`, repo access: your portfolio tracker repo
   - Copy the token — paste into cron-job.org header

---

## Step 5 — Test Run (2 min)

1. In GitHub → your repo → **Actions** → **Daily Portfolio Check** → **Run workflow**
2. Watch the logs — you should see each module print its data
3. Check Airtable — records should appear in **Daily Positions**
4. Once confirmed correct: delete the `DRY_RUN` variable (Settings → Variables → delete)

---

## Subscribing to the Audio Brief

After the first successful run:
1. Open any podcast app (Overcast, Pocket Casts, Apple Podcasts, Spotify)
2. Add RSS feed: `https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/kim-portfolio-tracker/main/brief/feed.xml`
3. New episode appears every morning at ~7:05 AM NZST

---

## One Thing to Update in the Code

Open `brief/update-rss.mjs` line 18 and replace:
```
const GITHUB_USERNAME = process.env.GITHUB_USERNAME ?? 'YOUR_GITHUB_USERNAME';
```
with your actual GitHub username, or add `GITHUB_USERNAME` as a GitHub Variable.

---

## What Runs When

| Time (NZST) | What happens |
|---|---|
| 7:00 AM | cron-job.org fires → GitHub Actions starts |
| ~7:02 AM | BloFin + GMX + Base LP + Sui data fetched in parallel |
| ~7:03 AM | Records written to Airtable |
| ~7:05 AM | Claude API generates brief text |
| ~7:06 AM | ElevenLabs converts to MP3 |
| ~7:07 AM | RSS feed updated, MP3 committed to GitHub |
| ~7:08 AM | Episode appears in your podcast app |

---

## Upgrading Later

- **Add a new position**: Create a new module in `modules/`, import it in `index.js`, add fields to Airtable
- **Change brief style**: Edit the system prompt in `brief/generate-brief.mjs`
- **Change voice**: Swap `ELEVENLABS_VOICE_ID` to any ElevenLabs voice ID
- **Add email delivery**: Add a SendGrid/Resend step in the GitHub Actions workflow after brief generation
