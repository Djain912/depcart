import * as path from 'path';
import * as vscode from 'vscode';
import { PickerViewProvider } from './pickerViewProvider';
import { setPypiIndexCacheFile } from './registries/pypi';

export function activate(context: vscode.ExtensionContext): void {
  setPypiIndexCacheFile(path.join(context.globalStorageUri.fsPath, 'pypi-names.txt'));
  const provider = new PickerViewProvider(context.extensionUri, context.workspaceState);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PickerViewProvider.viewId, provider),
    vscode.lm.onDidChangeChatModels(() => provider.refreshAiAvailability()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('depcart.aiFallback')) {
        void provider.refreshAiAvailability();
      }
    }),
  );
}
