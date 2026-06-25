import { execFileSync } from 'child_process';

/**
 * Save a credential token to the macOS Keychain.
 */
export function saveToKeychain(service: string, token: string): void {
  try {
    // -a: Account, -s: Service, -w: Password data, -U: Update if exists
    execFileSync('security', ['add-generic-password', '-a', 'unit01', '-s', `unit01-${service}`, '-w', token, '-U'], { stdio: 'ignore' });
  } catch (err) {
    throw new Error(`Failed to save credential for ${service} to macOS Keychain.`);
  }
}

/**
 * Retrieve a credential token from the macOS Keychain.
 */
export function getFromKeychain(service: string): string | null {
  try {
    const output = execFileSync('security', ['find-generic-password', '-a', 'unit01', '-s', `unit01-${service}`, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return output.trim();
  } catch (err) {
    return null;
  }
}

/**
 * Delete a credential from the macOS Keychain.
 */
export function deleteFromKeychain(service: string): void {
  try {
    execFileSync('security', ['delete-generic-password', '-a', 'unit01', '-s', `unit01-${service}`], { stdio: 'ignore' });
  } catch (err) {
    // Ignore errors if the item does not exist
  }
}
