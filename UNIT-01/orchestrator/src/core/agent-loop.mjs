/**
 * Agent Loop — async generator yielding 13 event types.
 * Handles streaming, tool calls, thinking, auto-compaction, hooks, multi-provider.
 */

import { ContextManager } from './context-manager.mjs';
import { buildSystemPrompt } from './system-prompt.mjs';

/** Maximum number of consecutive tool-use continuation turns before aborting. */
const MAX_TOOL_RECURSION_DEPTH = 50;

export function createAgentLoop({ model, tools, permissions, settings, hooks }) {
    const contextManager = new ContextManager(settings.maxContextTokens || 180000);

    // Build system prompt using the new builder
    const promptResult = buildSystemPrompt({
        cwd: process.cwd(),
        tools: tools.list?.() || [],
        override: settings.systemPromptOverride,
        addDirs: settings.addDirs,
    });

    const state = {
        messages: [],
        systemPrompt: promptResult.full,
        turnCount: 0,
        tokenUsage: { input: 0, output: 0 },
        model,
        tools,
        _contextManager: contextManager,
    };

    async function* run(userMessage, options = {}) {
        const depth = (options._depth || 0);

        // Guard against runaway tool-call recursion
        if (depth >= MAX_TOOL_RECURSION_DEPTH) {
            yield { type: 'error', message: `Max tool recursion depth (${MAX_TOOL_RECURSION_DEPTH}) reached. Stopping to prevent infinite loop.` };
            yield { type: 'stop', reason: 'max_recursion' };
            return;
        }

        // Add user message (skip for continuation turns)
        if (userMessage && !options.continuation) {
            state.messages = contextManager.addMessage(state.messages, {
                role: 'user',
                content: userMessage,
            });
            state.turnCount++;
        }

        // Check max turns
        if (settings.maxTurns && state.turnCount > settings.maxTurns) {
            yield { type: 'error', message: `Max turns (${settings.maxTurns}) reached.` };
            yield { type: 'stop', reason: 'max_turns' };
            return;
        }

        // Auto-compact if needed
        if (contextManager.shouldCompact(state.messages)) {
            yield { type: 'compaction', count: contextManager.compactionCount + 1 };
            state.messages = contextManager.compact(state.messages);
        }

        yield { type: 'stream_request_start', turn: state.turnCount };

        // Detect provider and call API
        const provider = detectProvider(state.model);
        let response;

        try {
            if (settings.stream !== false) {
                // Streaming mode
                response = await callApiStreaming(provider, state.model, state, tools.list(), settings);
                const collectedContent = [];
                let currentText = '';
                let currentThinking = '';

                for await (const event of response.events) {
                    if (event.type === 'content_block_start') {
                        if (event.content_block?.type === 'thinking') {
                            currentThinking = '';
                        }
                    } else if (event.type === 'content_block_delta') {
                        if (event.delta?.type === 'text_delta') {
                            currentText += event.delta.text;
                            yield { type: 'stream_event', text: event.delta.text };
                        } else if (event.delta?.type === 'thinking_delta') {
                            currentThinking += event.delta.thinking;
                            yield { type: 'thinking', text: event.delta.thinking };
                        }
                    } else if (event.type === 'ping') {
                        // Keepalive, ignore
                    }
                }

                // Use the accumulated message
                response = response.accumulated;
            } else {
                // Non-streaming mode
                response = await callApi(provider, state.model, state, tools.list(), settings);
            }
        } catch (err) {
            yield { type: 'error', message: err.message };
            return;
        }

        // Track token usage
        if (response.usage) {
            state.tokenUsage.input += response.usage.input_tokens || 0;
            state.tokenUsage.output += response.usage.output_tokens || 0;
        }

        // Build assistant message for history
        const assistantMessage = { role: 'assistant', content: response.content };
        state.messages.push(assistantMessage);

        // Process content blocks
        const toolUseBlocks = [];

        for (const block of response.content || []) {
            if (block.type === 'text') {
                yield { type: 'assistant', content: block.text };
            }

            if (block.type === 'thinking') {
                yield { type: 'thinking_complete', thinking: block.thinking };
            }

            if (block.type === 'tool_use') {
                toolUseBlocks.push(block);
            }
        }

        // Process tool calls
        if (toolUseBlocks.length > 0) {
            const toolResults = [];

            for (const block of toolUseBlocks) {
                // Run pre-tool hooks
                if (hooks) {
                    const hookResult = await hooks.runPreToolUse(block.name, block.input);
                    if (!hookResult.allow) {
                        yield { type: 'hookPermissionResult', tool: block.name, allowed: false, message: hookResult.message };
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: block.id,
                            content: `Blocked by hook: ${hookResult.message}`,
                        });
                        continue;
                    }
                }

                // Check permission
                const allowed = await permissions.check(block.name, block.input);
                if (!allowed) {
                    yield { type: 'hookPermissionResult', tool: block.name, allowed: false };
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: block.id,
                        content: 'Permission denied',
                    });
                    continue;
                }

                // Execute tool
                yield { type: 'tool_progress', tool: block.name, status: 'running' };

                let result;
                try {
                    result = await tools.call(block.name, block.input);
                } catch (err) {
                    result = `Tool error: ${err.message}`;
                }

                // Run post-tool hooks
                if (hooks) {
                    result = await hooks.runPostToolUse(block.name, result);
                }

                yield { type: 'result', tool: block.name, result };

                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: typeof result === 'string' ? result : JSON.stringify(result),
                });
            }

            // Add tool results as a single user message
            state.messages.push({ role: 'user', content: toolResults });

            // Recursive: continue the loop after tool execution
            yield* run(null, { continuation: true, _depth: depth + 1 });
            return;
        }

        // No tool calls — check stop hooks
        if (hooks) {
            const allowStop = await hooks.runStop();
            if (!allowStop) {
                // Hook prevented stopping — continue with a nudge
                state.messages = contextManager.addMessage(state.messages, {
                    role: 'user',
                    content: '[System: A hook prevented stopping. Please continue with the task.]',
                });
                yield* run(null, { continuation: true, _depth: depth + 1 });
                return;
            }
        }

        yield { type: 'stop', reason: response.stop_reason || 'end_turn' };
    }

    return { run, state };
}

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

function detectProvider(model) {
    return 'ollama';
}

async function callApi(provider, model, state, toolDefs, settings) {
    return callOllama(model, state, toolDefs, settings, false);
}

async function callApiStreaming(provider, model, state, toolDefs, settings) {
    return callOllama(model, state, toolDefs, settings, true);
}

async function callOllama(model, state, toolDefs, settings, stream) {
    const messages = [];
    if (state.systemPrompt) {
        messages.push({ role: 'system', content: state.systemPrompt });
    }
    for (const msg of state.messages) {
        if (typeof msg.content === 'string') {
            messages.push({ role: msg.role, content: msg.content });
        } else if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
                if (block.type === 'tool_result') {
                    messages.push({
                        role: 'tool',
                        content: block.content,
                    });
                }
            }
        }
    }

    const tools = toolDefs.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));

    const body = {
        model: model.replace('ollama/', ''),
        messages,
        stream,
        ...(tools.length > 0 && { tools }),
    };

    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Ollama API error ${res.status}: ${err}`);
    }

    if (stream) {
        return handleOllamaStream(res);
    }

    const data = await res.json();
    return convertOllamaResponse(data);
}

function handleOllamaStream(response) {
    const collected = [];
    const eventGenerator = async function* () {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                while (buffer.includes('\n')) {
                    const idx = buffer.indexOf('\n');
                    const line = buffer.slice(0, idx).trim();
                    buffer = buffer.slice(idx + 1);

                    if (!line) continue;

                    try {
                        const chunk = JSON.parse(line);
                        collected.push(chunk);

                        if (chunk.message?.content) {
                            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: chunk.message.content } };
                        }
                        if (chunk.done) {
                            yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
                        }
                    } catch {
                        // skip malformed lines
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    };

    return {
        events: eventGenerator(),
        get accumulated() {
            const fullContent = collected
                .filter(c => c.message?.content)
                .map(c => c.message.content)
                .join('');

            const toolCalls = collected
                .find(c => c.message?.tool_calls)
                ?.message?.tool_calls || [];

            const content = [];
            if (fullContent) content.push({ type: 'text', text: fullContent });
            for (const tc of toolCalls) {
                content.push({
                    type: 'tool_use',
                    id: tc.id || tc.function?.name || 'tool',
                    name: tc.function?.name || 'unknown',
                    input: (() => { try { return JSON.parse(tc.function?.arguments || '{}'); } catch { return {}; } })(),
                });
            }

            return {
                content,
                stop_reason: 'end_turn',
                usage: { input_tokens: 0, output_tokens: 0 },
            };
        },
    };
}

function convertOllamaResponse(data) {
    const content = [];
    if (data.message?.content) {
        content.push({ type: 'text', text: data.message.content });
    }

    if (data.message?.tool_calls) {
        for (const tc of data.message.tool_calls) {
            content.push({
                type: 'tool_use',
                id: tc.id || tc.function?.name || 'tool',
                name: tc.function?.name || 'unknown',
                input: (() => { try { return JSON.parse(tc.function?.arguments || '{}'); } catch { return {}; } })(),
            });
        }
    }

    return {
        content,
        stop_reason: data.done_reason === 'stop' ? 'end_turn' : (data.done_reason || 'end_turn'),
        usage: {
            input_tokens: data.prompt_eval_count || 0,
            output_tokens: data.eval_count || 0,
        },
    };
}
