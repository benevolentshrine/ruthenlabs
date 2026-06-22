import { getCredential } from '../vault.js';
import { getFromKeychain } from '../keychain.js';

/**
 * Retrieve Discord bot token from keychain (macOS) or encrypted vault (Linux).
 */
export function getDiscordToken(): string | null {
  if (process.platform === 'darwin') {
    return getFromKeychain('discord-token');
  }
  try {
    return getCredential('discord-token');
  } catch (_) {
    return null;
  }
}

/**
 * Send a message to a Discord channel.
 */
export async function postDiscordMessage(channelId: string, content: string): Promise<any> {
  const token = getDiscordToken();
  if (!token) throw new Error('Discord is not connected. Use /connect discord first.');

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bot ${token}`
    },
    body: JSON.stringify({ content })
  });

  if (!response.ok) {
    throw new Error(`Discord API error: Status ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

/**
 * Fetch recent messages from a Discord channel.
 */
export async function fetchDiscordMessages(channelId: string, limit = 10): Promise<any[]> {
  const token = getDiscordToken();
  if (!token) throw new Error('Discord is not connected. Use /connect discord first.');

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bot ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Discord API error: Status ${response.status}`);
  }
  return (await response.json()) as any[];
}
