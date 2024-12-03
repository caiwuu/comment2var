import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	// 使用 Map 存储每个文档的注释和变量映射
	const documentAnnotations: Map<string, Map<string, string>> = new Map();

	// 防抖函数
	function debounce<T extends (...args: any[]) => void>(callback: T, delay: number): (...args: Parameters<T>) => void {
		let timer: NodeJS.Timeout | null = null;
		return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
			if (timer) {
				clearTimeout(timer);
			}
			timer = setTimeout(() => {
				callback.apply(this, args);
			}, delay);
		};
	}


	// 解析文档，建立变量映射
	function parseDocument(doc: vscode.TextDocument) {
		// 过滤非文件类型的文档
		if (doc.uri.scheme !== 'file') {
			return;
		}

		// 检查文档是否在工作区中
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			return;
		}

		const isInWorkspace = workspaceFolders.some(folder => {
			return doc.uri.fsPath.startsWith(folder.uri.fsPath);
		});

		if (!isInWorkspace) {
			return;
		}

		// 排除 node_modules 和 .vscode 目录
		if (doc.uri.fsPath.includes('node_modules') || doc.uri.fsPath.includes('.vscode')) {
			return;
		}
		const text = doc.getText();
		const lines = text.split(/\r?\n/g);

		const annotationMap: Map<string, string> = new Map();

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// 匹配注释形式：// @注释
			const annotationMatch = line.match(/\/\/\s*@{1}\s*(.+)/);
			if (annotationMatch) {
				const annotation = annotationMatch[1].trim();

				// 查找下一个非空行，可能有空行或注释
				let j = i + 1;
				while (j < lines.length && lines[j].trim() === '') {
					j++;
				}
				if (j < lines.length) {
					const nextLine = lines[j];

					// 匹配变量声明或对象属性
					const variableMatch = nextLine.match(/(?:const|let|var)\s+(\w+)\s*=|(\w+)\s*:/);
					if (variableMatch) {
						const variableName = variableMatch[1] || variableMatch[2];
						annotationMap.set(annotation, variableName);

						// 添加调试日志
						// console.log(`Mapped annotation "${annotation}" to variable/property "${variableName}"`);
					}
				}
			}
		}

		documentAnnotations.set(doc.uri.toString(), annotationMap);
	}

	// 包装解析函数，添加防抖
	function parseDocumentWithDebounce(doc: vscode.TextDocument) {
		debounce(() => parseDocument(doc), 1000); // 300ms 防抖时间
	}

	const parseDocumentWithDebounce2 = debounce(parseDocument, 300);

	// 初次解析当前可见的文档
	vscode.window.visibleTextEditors.forEach(editor => {
		parseDocument(editor.document);
	});

	// 当可见编辑器发生变化时，解析新的文档
	vscode.window.onDidChangeVisibleTextEditors(editors => {
		try {
			if (editors && editors.length > 0) {
				editors.forEach(editor => {
					parseDocumentWithDebounce2(editor.document);
				});
			}
		} catch (error) {
			console.error('Error in onDidChangeVisibleTextEditors:', error);
		}
	});

	// 当文档发生变化时，重新解析（仅限可见的文档）
	vscode.workspace.onDidChangeTextDocument(event => {

		const doc = event.document;

		// 检查文档是否在可见编辑器中
		const isVisible = vscode.window.visibleTextEditors.some(editor => {
			return editor.document.uri.toString() === doc.uri.toString();
		});

		if (isVisible) {
			parseDocumentWithDebounce2(doc);
		}
	});


	// 注册代码提示提供者
	const provider = vscode.languages.registerCompletionItemProvider(
		['plaintext', 'javascript', 'typescript', 'vue'],
		{
			provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
				if (!document || !position) {
					return [];
				}

				// 过滤非文件类型的文档
				if (document.uri.scheme !== 'file') {
					return [];
				}

				const linePrefix = document.lineAt(position).text.substr(0, position.character);
				// 检查光标前的文本是否包含 "@"
				const atMatch = linePrefix.match(/@([^\s@]*)$/);
				if (atMatch) {
					const typedAnnotation = atMatch[1];
					const completionItems: vscode.CompletionItem[] = [];

					const annotationMap = documentAnnotations.get(document.uri.toString()) || new Map();

					// 查找匹配的注释
					for (const [annotation, variableName] of annotationMap) {
						if (annotation.startsWith(typedAnnotation)) {
							const completionItem = new vscode.CompletionItem(annotation, vscode.CompletionItemKind.Variable);
							completionItem.detail = `替换为: ${variableName}`;

							// 设置更高的优先级
							completionItem.sortText = '\0';
							completionItem.preselect = true;
							completionItem.filterText = '@' + annotation;

							// 使用 textEdit 替换文本
							if (position.character >= typedAnnotation.length + 1) {
								const startPos = position.translate(0, -typedAnnotation.length - 1);
								const range = new vscode.Range(startPos, position);
								completionItem.textEdit = vscode.TextEdit.replace(range, variableName);
							} else {
								// 如果光标位置不足，直接插入
								completionItem.textEdit = vscode.TextEdit.insert(position, variableName);
							}

							completionItems.push(completionItem);

							// 添加调试日志
							// console.log(`Providing completion for annotation "${annotation}" with variable/property "${variableName}"`);
						}
					}

					return completionItems;
				}

				return [];
			}
		},
		'@' // 指定 '@' 为触发字符
	);

	context.subscriptions.push(provider);
}
export function deactivate() { }