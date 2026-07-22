export default function extension(pi) {
  pi.registerProvider('openwaggle-reload-qa', {
    baseUrl: 'https://example.test/openwaggle-reload-qa/v1',
    apiKey: 'OPENWAGGLE_RELOAD_QA_API_KEY',
    api: 'openai-completions',
    models: [
      {
        id: 'fixture-model',
        name: 'Reload QA Fixture Model',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
  })
}
