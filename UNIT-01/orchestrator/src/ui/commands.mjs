import { ESSENTIAL } from './commands/essential.mjs';

export const COMMANDS = { ...ESSENTIAL };

export async function executeCommand(input, state) {
    const parts = input.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    const command = COMMANDS[cmd];
    if (!command) {
        return { response: `Unknown command: ${cmd}. Type /help for available commands.`, exit: false };
    }

    const response = await command.handler(args, state, COMMANDS);
    return { response, exit: response === 'EXIT' };
}

export function getCompletions(partial) {
    return Object.keys(COMMANDS).filter(c => c.startsWith(partial));
}
