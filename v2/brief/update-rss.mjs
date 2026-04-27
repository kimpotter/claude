/**
 * RSS Feed Updater
 * Prepends today's brief episode to feed.xml (max 30 episodes).
 * Commits the updated feed + MP3 to the GitHub repo so the RSS URL is stable.
 *
 * Subscribe URL (after first run):
 *   https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/brief/feed.xml
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Update these two lines with your GitHub username and repo name
const GITHUB_USERNAME = process.env.GITHUB_USERNAME ?? 'YOUR_GITHUB_USERNAME';
const REPO_NAME = process.env.REPO_NAME ?? 'kim-portfolio-tracker';
const BASE_URL = `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${REPO_NAME}/main`;

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function updateFeed() {
  const briefPath = join(__dirname, 'brief-latest.json');
  const brief = JSON.parse(readFileSync(briefPath, 'utf8'));
  const { text, date, audioFile } = brief;

  // Estimate file size for RSS enclosure
  const audioPath = join(__dirname, '..', audioFile);
  let audioSize = 0;
  try {
    const { statSync } = await import('fs');
    audioSize = statSync(audioPath).size;
  } catch { /* ok */ }

  const pubDate = new Date().toUTCString();
  const audioUrl = `${BASE_URL}/${audioFile}`;

  const newItem = `
  <item>
    <title>Portfolio Brief — ${date}</title>
    <description>${escapeXml(text)}</description>
    <pubDate>${pubDate}</pubDate>
    <guid isPermaLink="false">portfolio-brief-${date}</guid>
    <enclosure url="${audioUrl}" type="audio/mpeg" length="${audioSize}"/>
  </item>`;

  // Parse existing feed or create fresh
  const feedPath = join(__dirname, 'feed.xml');
  let existingItems = '';
  if (existsSync(feedPath)) {
    const existing = readFileSync(feedPath, 'utf8');
    const itemsMatch = existing.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    // Keep last 29 items (we're adding 1 new one = 30 total)
    existingItems = itemsMatch.slice(0, 29).join('\n');
  }

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Kim's Portfolio Brief</title>
    <description>Daily DeFi portfolio briefing — delta-neutral strategy, LP performance, algo bot PnL</description>
    <link>${BASE_URL}</link>
    <language>en-au</language>
    <itunes:author>Portfolio Tracker</itunes:author>
    <itunes:category text="Business"/>
    <itunes:explicit>false</itunes:explicit>
    ${newItem}
    ${existingItems}
  </channel>
</rss>`;

  writeFileSync(feedPath, feed);
  console.log(`RSS feed updated: brief/feed.xml (subscribe: ${BASE_URL}/brief/feed.xml)`);

  // Commit and push the updated feed + audio to GitHub
  try {
    execSync('git config user.email "portfolio-bot@github-actions"');
    execSync('git config user.name "Portfolio Bot"');
    execSync(`git add brief/feed.xml "${audioFile}"`);
    execSync(`git commit -m "chore: daily brief ${date}"`);
    execSync('git push');
    console.log('RSS feed committed and pushed to GitHub.');
  } catch (e) {
    console.warn('Git commit failed (may be first run or no changes):', e.message);
  }
}

updateFeed().catch(err => {
  console.error('RSS update failed:', err);
  process.exit(1);
});
