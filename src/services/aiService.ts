import * as vscode from 'vscode';
import {
  AiService,
  AiOptions,
  AiProfile,
  AiProfileService,
  AiProfileNotConfiguredError,
  AiProfileUnavailableError,
} from '../core/types';

// ─── Delegating service (used by the ServiceContainer) ───────────────────────

export class DelegatingAiService implements AiService {
  constructor(
    private readonly profileService: AiProfileService,
    private readonly context: vscode.ExtensionContext
  ) {}

  async complete(prompt: string, options?: AiOptions): Promise<string> {
    const impl = await this.resolveImplementation();
    return impl.complete(prompt, options);
  }

  async stream(
    prompt: string,
    onChunk: (chunk: string) => void,
    token?: vscode.CancellationToken
  ): Promise<void> {
    const impl = await this.resolveImplementation();
    return impl.stream(prompt, onChunk, token);
  }

  private async resolveImplementation(): Promise<AiService> {
    const profile = this.profileService.getActiveProfile();
    if (!profile) {throw new AiProfileNotConfiguredError();}

    switch (profile.provider) {
      case 'copilot':
        return new CopilotAiService(profile);
      case 'anthropic':
        return new AnthropicAiService(profile, this.profileService);
      case 'openai':
        return new OpenAiService(profile, this.profileService);
      default:
        throw new AiProfileUnavailableError(profile.id);
    }
  }
}

// ─── GitHub Copilot (VS Code LM API) ─────────────────────────────────────────

class CopilotAiService implements AiService {
  constructor(private readonly profile: AiProfile) {}

  async complete(prompt: string, options?: AiOptions): Promise<string> {
    const model = await this.selectModel();
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const requestOptions: vscode.LanguageModelChatRequestOptions = {};

    if (options?.systemPrompt) {
      messages.unshift(vscode.LanguageModelChatMessage.Assistant(options.systemPrompt));
    }

    const response = await model.sendRequest(messages, requestOptions, new vscode.CancellationTokenSource().token);
    let result = '';
    for await (const chunk of response.stream) {
      if (chunk instanceof vscode.LanguageModelTextPart) {
        result += chunk.value;
      }
    }
    return result;
  }

  async stream(
    prompt: string,
    onChunk: (chunk: string) => void,
    token?: vscode.CancellationToken
  ): Promise<void> {
    const model = await this.selectModel();
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const cts = token ? undefined : new vscode.CancellationTokenSource();
    const cancelToken = token ?? cts!.token;

    const response = await model.sendRequest(messages, {}, cancelToken);
    for await (const chunk of response.stream) {
      if (chunk instanceof vscode.LanguageModelTextPart) {
        onChunk(chunk.value);
      }
    }
  }

  private async selectModel(): Promise<vscode.LanguageModelChat> {
    const models = await vscode.lm.selectChatModels({ family: this.profile.model });
    if (!models.length) {
      throw new AiProfileUnavailableError(
        this.profile.id,
        new Error(`No Copilot model found for family "${this.profile.model}". Ensure GitHub Copilot is active.`)
      );
    }
    return models[0];
  }
}

// ─── Anthropic (direct API) ───────────────────────────────────────────────────

class AnthropicAiService implements AiService {
  constructor(
    private readonly profile: AiProfile,
    private readonly profileService: AiProfileService
  ) {}

  async complete(prompt: string, options?: AiOptions): Promise<string> {
    const { Anthropic } = await import('@anthropic-ai/sdk');
    const apiKey = await this.profileService.getApiKey(this.profile.id);
    if (!apiKey) {throw new AiProfileUnavailableError(this.profile.id, new Error('API key not found in secure storage.'));}

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: this.profile.model,
      max_tokens: options?.maxTokens ?? 4096,
      system: options?.systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    return block.type === 'text' ? block.text : '';
  }

  async stream(
    prompt: string,
    onChunk: (chunk: string) => void,
    _token?: vscode.CancellationToken
  ): Promise<void> {
    const { Anthropic } = await import('@anthropic-ai/sdk');
    const apiKey = await this.profileService.getApiKey(this.profile.id);
    if (!apiKey) {throw new AiProfileUnavailableError(this.profile.id, new Error('API key not found in secure storage.'));}

    const client = new Anthropic({ apiKey });
    const stream = client.messages.stream({
      model: this.profile.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        onChunk(event.delta.text);
      }
    }
  }
}

// ─── OpenAI (direct API) ──────────────────────────────────────────────────────

class OpenAiService implements AiService {
  constructor(
    private readonly profile: AiProfile,
    private readonly profileService: AiProfileService
  ) {}

  async complete(prompt: string, options?: AiOptions): Promise<string> {
    const apiKey = await this.profileService.getApiKey(this.profile.id);
    if (!apiKey) {throw new AiProfileUnavailableError(this.profile.id, new Error('API key not found in secure storage.'));}

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.profile.model,
        max_tokens: options?.maxTokens ?? 4096,
        messages: [
          ...(options?.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new AiProfileUnavailableError(this.profile.id, new Error(`OpenAI API error: ${response.statusText}`));
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? '';
  }

  async stream(
    prompt: string,
    onChunk: (chunk: string) => void,
    _token?: vscode.CancellationToken
  ): Promise<void> {
    // Streaming via fetch SSE — delegate to complete for now
    const result = await this.complete(prompt);
    onChunk(result);
  }
}
