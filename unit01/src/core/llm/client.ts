import { execSync } from 'child_process';

export interface OllamaModel {
  name: string;
  details: {
    parameter_size: string;
    quantization_level: string;
  };
}

export class OllamaClient {
  private host: string;

  constructor(host = 'http://127.0.0.1:11434') {
    this.host = host;
  }

  /**
   * List all downloaded local models.
   */
  public async listModels(): Promise<OllamaModel[]> {
    try {
      const res = await fetch(`${this.host}/api/tags`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = (await res.json()) as { models: OllamaModel[] };
      return data.models || [];
    } catch (err) {
      console.warn('[Ollama Client] Could not query local Ollama server. Ensure it is running.');
      return [];
    }
  }

  /**
   * Query model details to extract the native context window limit (num_ctx).
   */
  public async getContextLimit(modelName: string): Promise<number> {
    try {
      const res = await fetch(`${this.host}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName })
      });
      if (!res.ok) return 4096; // Fallback default
      
      const data = (await res.json()) as { 
        parameters?: string; 
        system?: string;
        model_info?: Record<string, any>;
      };
      
      // 1. Try checking model_info for any key ending in .context_length
      if (data.model_info) {
        for (const [key, val] of Object.entries(data.model_info)) {
          if (key.endsWith('.context_length') && typeof val === 'number') {
            return val;
          }
        }
      }
      
      // 2. Fallback: Parse parameters for num_ctx
      if (data.parameters) {
        const match = /num_ctx\s+(\d+)/.exec(data.parameters);
        if (match) {
          return parseInt(match[1], 10);
        }
      }
      return 4096; // Default Ollama context window size fallback
    } catch (err) {
      return 4096; // Fallback default on error
    }
  }

  /**
   * Send a streaming chat payload to the local model.
   */
  public async chatStream(
    modelName: string,
    messages: { role: string; content: string }[],
    contextLimit: number,
    onChunk: (text: string) => void,
    signal?: AbortSignal
  ): Promise<{ content: string; usage: { input_tokens: number; output_tokens: number } }> {
    const res = await fetch(`${this.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages,
        options: {
          num_ctx: contextLimit,
          temperature: 0.1 // Low temperature for deterministic coding tasks
        },
        stream: true
      }),
      signal
    });

    if (!res.ok) {
      throw new Error(`Ollama chat stream failed: ${res.statusText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('Could not get response stream reader');
    }

    let input_tokens = 0;
    let output_tokens = 0;

    try {
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          let chunk: string | undefined;
          try {
            const json = JSON.parse(line) as {
              message?: { content: string };
              done?: boolean;
              prompt_eval_count?: number;
              eval_count?: number;
            };
            if (json.message?.content) {
              chunk = json.message.content;
            }
            if (json.prompt_eval_count !== undefined) {
              input_tokens = json.prompt_eval_count;
            }
            if (json.eval_count !== undefined) {
              output_tokens = json.eval_count;
            }
          } catch (e) {
            // ignore parsing error for malformed lines
          }

          if (chunk !== undefined) {
            fullText += chunk;
            onChunk(chunk);
          }
        }
      }

      return {
        content: fullText,
        usage: {
          input_tokens,
          output_tokens
        }
      };
    } catch (err) {
      try {
        await reader.cancel();
      } catch (_) {}
      throw err;
    }
  }
}
export const ollama = new OllamaClient();
