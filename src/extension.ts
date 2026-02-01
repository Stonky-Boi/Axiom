import * as vscode from "vscode";

/* ---------------- Language Scoping ---------------- */

const supported_languages = new Set(["python", "c", "cpp"]);

function is_supported(document: vscode.TextDocument): boolean {
	return supported_languages.has(document.languageId);
}

const language_selector: vscode.DocumentSelector = [
	{ language: "python", scheme: "file" },
	{ language: "c", scheme: "file" },
	{ language: "cpp", scheme: "file" }
];

/* ---------------- Pending Edit State ---------------- */

let pending_edit:
	| {
		uri: vscode.Uri;
		range: vscode.Range;
		old_text: string;
		new_text: string;
	}
	| null = null;

/* ---------------- CodeLens Provider ---------------- */

class PendingEditCodeLensProvider implements vscode.CodeLensProvider {
	private readonly on_change_emitter =
		new vscode.EventEmitter<void>();

	public readonly onDidChangeCodeLenses =
		this.on_change_emitter.event;

	refresh(): void {
		this.on_change_emitter.fire();
	}

	provideCodeLenses(
		document: vscode.TextDocument
	): vscode.CodeLens[] {
		if (
			!pending_edit ||
			document.uri.toString() !==
			pending_edit.uri.toString()
		) {
			return [];
		}

		return [
			new vscode.CodeLens(pending_edit.range, {
				title: "Accept",
				command: "axiom.acceptEdit"
			}),
			new vscode.CodeLens(pending_edit.range, {
				title: "Reject",
				command: "axiom.rejectEdit"
			})
		];
	}
}

/* ---------------- Inline Completion State ---------------- */

let inline_timer: NodeJS.Timeout | undefined;

/* ---------------- Extension Lifecycle ---------------- */

export function activate(context: vscode.ExtensionContext) {
	console.log("Axiom activated");

	const codelens_provider = new PendingEditCodeLensProvider();

	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			language_selector,
			codelens_provider
		)
	);

	/* ======================================================
	   Inline Completion Loop
	   Trigger: typing / cursor movement
	   Output: ghost text
	   ====================================================== */

	const inline_completion_provider: vscode.InlineCompletionItemProvider =
	{
		provideInlineCompletionItems(
			document,
			position,
			_context,
			token
		) {
			if (!is_supported(document)) {
				return;
			}

			return new Promise((resolve) => {
				if (inline_timer) {
					clearTimeout(inline_timer);
				}

				inline_timer = setTimeout(() => {
					if (token.isCancellationRequested) {
						return resolve([]);
					}

					const diagnostics =
						vscode.languages.getDiagnostics(document.uri);

					const has_error_near_cursor =
						diagnostics.some(d =>
							d.range.contains(position)
						);

					const completion_text =
						has_error_near_cursor
							? " // mocked fix suggestion"
							: " // mocked inline completion";

					resolve([
						new vscode.InlineCompletionItem(
							completion_text,
							new vscode.Range(position, position)
						)
					]);
				}, 200);
			});
		}
	};

	context.subscriptions.push(
		vscode.languages.registerInlineCompletionItemProvider(
			language_selector,
			inline_completion_provider
		)
	);

	/* ======================================================
	   Explicit Command Loop
	   Trigger: command palette
	   Output: pending structured edit
	   ====================================================== */

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"axiom.applyEdit",
			async () => {
				const editor =
					vscode.window.activeTextEditor;

				if (
					!editor ||
					!is_supported(editor.document)
				) {
					return;
				}

				const document = editor.document;
				const selection = editor.selection;

				const target_range =
					selection.isEmpty
						? document.lineAt(
							selection.active.line
						).range
						: selection;

				const old_text =
					document.getText(target_range);

				const new_text =
					old_text + "\n// mocked edit applied";

				pending_edit = {
					uri: document.uri,
					range: target_range,
					old_text,
					new_text
				};

				codelens_provider.refresh();
			}
		)
	);

	/* ======================================================
	   Hover Explanation Loop
	   Trigger: hover on symbol
	   Output: short tooltip
	   ====================================================== */

	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			language_selector,
			{
				provideHover(document, position) {
					if (!is_supported(document)) {
						return;
					}

					const range =
						document.getWordRangeAtPosition(
							position
						);

					if (!range) {
						return;
					}

					const symbol =
						document.getText(range);

					return new vscode.Hover(
						`**Axiom explanation (mocked):**\n\nExplanation for \`${symbol}\`.`,
						range
					);
				}
			}
		)
	);

	/* ======================================================
	   Chat Loop
	   Trigger: command
	   Output: pending edit via CodeLens
	   ====================================================== */

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"axiom.chat",
			async () => {
				const editor =
					vscode.window.activeTextEditor;

				if (
					!editor ||
					!is_supported(editor.document)
				) {
					return;
				}

				const prompt =
					await vscode.window.showInputBox({
						prompt: "Ask Axiom"
					});

				if (!prompt) {
					return;
				}

				const document = editor.document;
				const position =
					editor.selection.active;

				const diagnostics =
					vscode.languages.getDiagnostics(
						document.uri
					);

				const diagnostic_summary =
					diagnostics
						.map(d => d.message)
						.join("; ");

				const new_text = [
					"// Chat response (mocked)",
					`// Prompt: ${prompt}`,
					`// Diagnostics: ${diagnostic_summary}`
				].join("\n");

				const range = new vscode.Range(
					position,
					position
				);

				pending_edit = {
					uri: document.uri,
					range,
					old_text: "",
					new_text: `\n${new_text}`
				};

				codelens_provider.refresh();
			}
		)
	);

	/* ======================================================
	   Accept / Reject Commands
	   ====================================================== */

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"axiom.acceptEdit",
			async () => {
				if (!pending_edit) {
					return;
				}

				const edit =
					new vscode.WorkspaceEdit();

				edit.replace(
					pending_edit.uri,
					pending_edit.range,
					pending_edit.new_text
				);

				await vscode.workspace.applyEdit(edit);

				pending_edit = null;
				codelens_provider.refresh();
			}
		),

		vscode.commands.registerCommand(
			"axiom.rejectEdit",
			() => {
				pending_edit = null;
				codelens_provider.refresh();
			}
		)
	);
}

export function deactivate() { }