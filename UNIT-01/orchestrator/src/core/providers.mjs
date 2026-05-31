const PROVIDERS = {
    ollama: {
        name: 'Ollama',
        endpoint: 'http://localhost:11434/api/chat',
        envKey: null,
        authHeader() {
            return { 'Content-Type': 'application/json' };
        },
        models: ['llama3.2', 'llama3.1', 'mistral', 'codellama', 'deepseek-coder'],
    },
};

export function getProvider(model) {
    return PROVIDERS.ollama;
}

export function getProviderByName(name) {
    return PROVIDERS[name];
}

export function listProviders() {
    return Object.entries(PROVIDERS).map(([key, p]) => ({
        id: key,
        name: p.name,
        envKey: p.envKey,
        models: p.models || [],
        hasEndpoint: !!p.endpoint,
    }));
}

export function checkProviderKeys() {
    return Object.entries(PROVIDERS).map(([key, p]) => ({
        id: key,
        name: p.name,
        configured: true,
    }));
}

export { PROVIDERS };
