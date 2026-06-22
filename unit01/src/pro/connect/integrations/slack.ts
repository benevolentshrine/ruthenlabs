import { getCredential } from '../vault.js';
import { getFromKeychain } from '../keychain.js';

/**
 * Retrieve Slack token from keychain (macOS) or encrypted vault (Linux).
 */
export function getSlackToken(): string | null {
  if (process.platform === 'darwin') {
    return getFromKeychain('slack-token');
  }
  try {
    return getCredential('slack-token');
  } catch (_) {
    return null;
  }
}

/**
 * Send a message or thread reply to a Slack channel/DM.
 */
export async function postSlackMessage(channel: string, text: string, threadTs?: string): Promise<any> {
  const token = getSlackToken();
  if (!token) throw new Error('Slack is not connected. Use /connect slack first.');

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      channel,
      text,
      thread_ts: threadTs
    })
  });

  const data = (await response.json()) as any;
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
  return data;
}

/**
 * Fetch recent message history from a Slack channel.
 */
export async function fetchSlackMessages(channel: string, limit = 10): Promise<any[]> {
  const token = getSlackToken();
  if (!token) throw new Error('Slack is not connected. Use /connect slack first.');

  const response = await fetch(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(channel)}&limit=${limit}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const data = (await response.json()) as any;
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
  return data.messages || [];
}

/**
 * Fetch thread replies for a specific message thread.
 */
export async function fetchSlackReplies(channel: string, threadTs: string, limit = 10): Promise<any[]> {
  const token = getSlackToken();
  if (!token) throw new Error('Slack is not connected. Use /connect slack first.');

  const response = await fetch(`https://slack.com/api/conversations.replies?channel=${encodeURIComponent(channel)}&ts=${encodeURIComponent(threadTs)}&limit=${limit}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const data = (await response.json()) as any;
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
  return data.messages || [];
}
