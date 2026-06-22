import { getCredential } from '../vault.js';
import { getFromKeychain } from '../keychain.js';

/**
 * Retrieve Telegram token from keychain (macOS) or encrypted vault (Linux).
 */
export function getTelegramToken(): string | null {
  if (process.platform === 'darwin') {
    return getFromKeychain('telegram-token');
  }
  try {
    return getCredential('telegram-token');
  } catch (_) {
    return null;
  }
}

/**
 * Send a message to a Telegram group, channel, or user.
 */
export async function postTelegramMessage(chatId: string, text: string): Promise<any> {
  const token = getTelegramToken();
  if (!token) throw new Error('Telegram is not connected. Use /connect telegram first.');

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown'
    })
  });

  const data = (await response.json()) as any;
  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description}`);
  }
  return data.result;
}

/**
 * Fetch bot updates (recent messages/alerts sent to the bot).
 */
export async function fetchTelegramUpdates(limit = 10): Promise<any[]> {
  const token = getTelegramToken();
  if (!token) throw new Error('Telegram is not connected. Use /connect telegram first.');

  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=${limit}`, {
    method: 'GET'
  });

  const data = (await response.json()) as any;
  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description}`);
  }
  return data.result || [];
}
