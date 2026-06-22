import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import { getCredential } from '../vault.js';
import { getFromKeychain } from '../keychain.js';

const QUOTA_FILE = path.join(homedir(), '.unit01', 'search_quota.json');
const themeAccent = chalk.hex('#38BDF8');

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface QuotaData {
  date: string;
  count: number;
}

/**
 * Helper to check and update the daily search quota for Google.
 * Capped at 100 requests per day (resets at local midnight).
 */
function checkAndUpdateQuota(): boolean {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  let data: QuotaData = { date: today, count: 0 };

  try {
    if (fs.existsSync(QUOTA_FILE)) {
      data = JSON.parse(fs.readFileSync(QUOTA_FILE, 'utf8')) as QuotaData;
    }
  } catch (e) {
    // Ignore read errors, overwrite if corrupt
  }

  if (data.date !== today) {
    data.date = today;
    data.count = 0;
  }

  if (data.count >= 100) {
    return false; // Quota exceeded
  }

  data.count += 1;
  try {
    const dir = path.dirname(QUOTA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(QUOTA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    // Ignore write errors
  }
  return true;
}

/**
 * Retrieve the Google Custom Search API Credentials.
 */
function getGoogleCredentials(): { key: string; cx: string } | null {
  // Try retrieving from keychain or vault
  let key: string | null = null;
  let cx: string | null = null;

  if (process.platform === 'darwin') {
    key = getFromKeychain('google-api-key');
    cx = getFromKeychain('google-cx');
  } else {
    try {
      key = getCredential('google-api-key');
      cx = getCredential('google-cx');
    } catch (_) {}
  }

  if (key && cx) return { key, cx };
  return null;
}

/**
 * Fetch search results using DuckDuckGo Lite (HTML parsing snippet extractor).
 */
export async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  try {
    const response = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: `q=${encodeURIComponent(query)}`
    });

    if (!response.ok) throw new Error(`DDG response status ${response.status}`);
    const html = await response.text();
    const results: SearchResult[] = [];

    // Simple HTML regex parser targeting DuckDuckGo Lite search table structure
    const resultBlockRegex = /<td class="result-snippet">([\s\S]*?)<\/td>/gi;
    const linkRegex = /<a class="result-link" href="([\s\S]*?)">([\s\S]*?)<\/a>/i;
    
    let match;
    let index = 0;
    
    // We split the HTML by result rows to map links to snippets
    const rows = html.split('<tr');
    for (const row of rows) {
      if (results.length >= 5) break;

      const linkMatch = linkRegex.exec(row);
      if (!linkMatch) continue;

      const href = linkMatch[1].trim();
      const title = linkMatch[2].replace(/<[^>]*>/g, '').trim(); // Strip HTML tags
      
      // Get the snippet (usually in the next TD or in the same row)
      const snippetMatch = resultBlockRegex.exec(row) || /<td[\s\S]*?>([\s\S]*?)<\/td>/i.exec(row);
      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : '';

      if (href.startsWith('http')) {
        results.push({
          title,
          url: href,
          snippet: snippet.substring(0, 300)
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error('[DDG Search] Failed to query DuckDuckGo:', error);
    return [];
  }
}

/**
 * Fetch search results using Google Custom Search API.
 */
async function searchGoogle(query: string, key: string, cx: string): Promise<SearchResult[]> {
  const url = `https://customsearch.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=5`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google API status ${response.status}`);
  }
  const data = (await response.json()) as any;
  const items = data.items || [];
  
  return items.map((item: any) => ({
    title: item.title || '',
    url: item.link || '',
    snippet: item.snippet || ''
  }));
}

/**
 * Executive search gateway logic.
 * Tries Google API, tracks quota, and auto-falls back to DDG if quota exceeded.
 */
export async function executeWebSearch(query: string): Promise<SearchResult[]> {
  const creds = getGoogleCredentials();

  if (creds) {
    const quotaOk = checkAndUpdateQuota();
    if (quotaOk) {
      try {
        return await searchGoogle(query, creds.key, creds.cx);
      } catch (err) {
        console.warn(chalk.yellow(`ॐ Google search failed — falling back to DuckDuckGo. Error: ${err}`));
        return await searchDuckDuckGo(query);
      }
    } else {
      console.log(chalk.yellow(`ॐ Google search quota (100/day) reached — switching to DuckDuckGo`));
      // Artificial delay to prevent DDG rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
      return await searchDuckDuckGo(query);
    }
  }

  // No Google API credentials provided, query DDG directly
  return await searchDuckDuckGo(query);
}
