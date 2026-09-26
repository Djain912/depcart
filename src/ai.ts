import * as vscode from 'vscode';
import { buildSuggestionPrompt, parseSuggestions } from './aiSuggestions';
import type { Registry } from './registries/types';

/** Whatever chat model the editor offers (e.g. GitHub Copilot); no API key of our own. */
async function pickModel(): Promise<vscode.LanguageModelChat | undefined> {
  const copilot = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  return copilot[0] ?? (await vscode.lm.selectChatModels())[0];
}

export async function aiAvailable(): Promise<boolean> {
  return !!(await pickModel());
}

export async function suggestPackages(registries: Registry[], query: string, signal: AbortSignal): Promise<Record<string, string[]>> {
  const model = await pickModel();
  if (!model) {
    throw new Error('no AI model is available in VS Code (for example, install GitHub Copilot Chat)');
  }
  const cancel = new vscode.CancellationTokenSource();
  const onAbort = () => cancel.cancel();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(buildSuggestionPrompt(registries, query))],
      { justification: 'DepCart asks for package names when registry search finds nothing.' },
      cancel.token,
    );
    let text = '';
    for await (const chunk of response.text) {
      text += chunk;
    }
    return parseSuggestions(text, registries);
  } finally {
    signal.removeEventListener('abort', onAbort);
    cancel.dispose();
  }
}
