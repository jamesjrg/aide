/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ChatViewId } from './aideAgent.js';

import { DevtoolsStatus, IDevtoolsService } from '../common/devtoolsService.js';
import { CONTEXT_DEVTOOLS_STATUS, CONTEXT_IS_DEVTOOLS_FEATURE_ENABLED, CONTEXT_IS_INSPECTING_HOST } from '../common/devtoolsServiceContextKeys.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ChatViewPane } from './aideAgentViewPane.js';
import { Location } from '../../../../editor/common/languages.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ChatDynamicVariableModel } from './contrib/aideAgentDynamicVariables.js';
import { IDynamicVariable } from '../common/aideAgentVariables.js';
import { localize } from '../../../../nls.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { AgentMode } from '../../../../platform/aideAgent/common/model.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { convertBufferToScreenshotVariable } from './contrib/screenshot.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileQuery, ISearchService, QueryType } from '../../../services/search/common/search.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IPreviewPartService } from '../../../services/previewPart/browser/previewPartService.js';

export class DevtoolsService extends Disposable implements IDevtoolsService {
	declare _serviceBrand: undefined;

	private readonly _onDidChangeStatus = this._register(new Emitter<DevtoolsStatus>());
	public readonly onDidChangeStatus = this._onDidChangeStatus.event;

	private readonly _onDidTriggerInspectingHostStart = this._register(new Emitter<void>());
	public readonly onDidTriggerInspectingHostStart = this._onDidTriggerInspectingHostStart.event;

	private readonly _onDidTriggerInspectingHostStop = this._register(new Emitter<void>());
	public readonly onDidTriggerInspectingHostStop = this._onDidTriggerInspectingHostStop.event;

	private _isFeatureEnabled: IContextKey<boolean>;

	private _status: IContextKey<DevtoolsStatus>;
	get status(): DevtoolsStatus {
		const contextKeyValue = this._status.get();
		if (contextKeyValue === undefined) {
			console.error(`Context key for ${CONTEXT_DEVTOOLS_STATUS.key} is undefined. Resetting`);
			this._status.reset();
		}
		return this._status.get()!;
	}

	set status(status: DevtoolsStatus) {
		this._status.set(status);
		this.notifyStatusChange();
	}

	private _latestPayload: Location | null = null;
	get latestPayload() {
		return this._latestPayload;
	}

	set latestPayload(payload: Location | null) {
		this._latestPayload = payload;
	}

	private _latestResource: URI | undefined;
	get latestResource() {
		return this._latestResource;
	}

	private _isInspecting: IContextKey<boolean>;
	get isInspecting() {
		const contextKeyValue = this._isInspecting.get();
		if (contextKeyValue === undefined) {
			console.error(`Context key for ${CONTEXT_IS_INSPECTING_HOST.key} in is undefined. Resetting`);
			this._isInspecting.reset();
		}
		return this._isInspecting.get()!;
	}

	set isInspecting(isInspecting: boolean) {
		this._isInspecting.set(isInspecting);
		// Stopped inspecting and we have some payload
		if (!isInspecting && this._latestPayload !== null) {
			this.addReference(this._latestPayload);
		}
	}

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IViewsService private readonly viewsService: IViewsService,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INotificationService private readonly notificationService: INotificationService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IHostService private readonly hostService: IHostService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ISearchService private readonly searchService: ISearchService,
		@IPreviewPartService private readonly previewPartService: IPreviewPartService
	) {
		super();

		this._status = CONTEXT_DEVTOOLS_STATUS.bindTo(this.contextKeyService);
		this._isInspecting = CONTEXT_IS_INSPECTING_HOST.bindTo(this.contextKeyService);
		this._isFeatureEnabled = CONTEXT_IS_DEVTOOLS_FEATURE_ENABLED.bindTo(this.contextKeyService);

		// Check current state of your config at startup:
		this.updateConfig();

		// Subscribe to config changes:
		this._register(
			this.configurationService.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('aide')) {
					this.updateConfig();
				}
			})
		);
	}

	async initialize() {
		const isReactProject = await this.hasReactDependencyInAnyPackageJson();
		if (isReactProject) {
			this.configurationService.updateValue('aide.enableInspectWithDevtools', true);
		}
	}

	private async hasReactDependencyInAnyPackageJson(): Promise<boolean> {
		// Get all workspace folders (there may be multiple)
		const { folders } = await this.workspaceContextService.getCompleteWorkspace();
		if (!folders?.length) {
			return false;
		}

		for (const folder of folders) {
			// Search for all package.json files under the folder, excluding settings and ignore files
			const searchQuery: IFileQuery = {
				type: QueryType.File,
				folderQueries: [{ folder: folder.uri, disregardGlobalIgnoreFiles: false, disregardIgnoreFiles: false }],
				filePattern: 'package.json',
			};

			const searchResults = await this.searchService.fileSearch(searchQuery, CancellationToken.None);
			for (const fileMatch of searchResults.results) {
				try {
					// Load content of each package.json
					const fileContent = (await this.fileService.readFile(fileMatch.resource)).value.toString();
					const parsed = JSON.parse(fileContent);

					// Check if 'react' is in dependencies or devDependencies
					if (
						(parsed.dependencies && parsed.dependencies.react) ||
						(parsed.devDependencies && parsed.devDependencies.react)
					) {
						return true;
					}
				} catch {
					// Ignore file parsing errors
				}
			}
		}
		return false;
	}


	private getWidget() {
		const chatViewPane = this.viewsService.getViewWithId<ChatViewPane>(ChatViewId);
		if (!chatViewPane) {
			throw new Error(`Chat view pane must be initialized before calling the Devtools service`);
		}
		return chatViewPane.widget;
	}


	private updateConfig(): void {
		// Read the configuration value:
		const isEnabled = !!this.configurationService.getValue<boolean>('aide.enableInspectWithDevtools');
		this._isFeatureEnabled.set(isEnabled);
	}


	private notifyStatusChange() {
		const isDevelopment = !this.environmentService.isBuilt || this.environmentService.isExtensionDevelopment;
		if (isDevelopment) {
			console.log('Devtools service status: ', this.status);
		}
		// This can be used as a proxy if the user has opened the browser preview
		if (this.status === DevtoolsStatus.DevtoolsConnected) {
			const widget = this.getWidget();
			widget.input.setMode(AgentMode.Agentic);
		}
		this._onDidChangeStatus.fire(this.status);
	}


	private async addReference(payload: Location | null) {
		const widget = this.getWidget();
		const input = widget.inputEditor;
		const inputModel = input.getModel();

		if (!inputModel) {
			return;
		}

		const dynamicVariablesModel = widget.getContrib<ChatDynamicVariableModel>(ChatDynamicVariableModel.ID);
		if (!dynamicVariablesModel) {
			return;
		}

		if (payload === null) {
			this.notifyProjectNotSupported();
		} else if (widget.viewModel?.model) {
			widget.viewModel.model.isDevtoolsContext = true;

			const file = await this.fileService.stat(payload.uri);
			const displayName = `@${file.name}:${payload.range.startLineNumber}-${payload.range.endLineNumber}`;
			const inputModelFullRange = inputModel.getFullModelRange();
			// By default, append to the end of the model
			let replaceRange = {
				startColumn: inputModelFullRange.endColumn,
				endColumn: inputModelFullRange.endColumn,
				startLineNumber: inputModelFullRange.endLineNumber,
				endLineNumber: inputModelFullRange.endLineNumber,
			};

			const selection = input.getSelection();
			// If there is a selection, use that
			if (selection) {
				replaceRange = {
					startColumn: selection.startColumn,
					endColumn: selection.endColumn,
					startLineNumber: selection.startLineNumber,
					endLineNumber: selection.endLineNumber
				};
			}
			const isLeading = replaceRange.startColumn === 1;
			// Add leading space if we are not at the very beginning of the text model
			const output = isLeading ? displayName : ' ' + displayName;

			const screenshot = await this.hostService.getScreenshot();




			if (screenshot) {
				const previewBoundingClientRect = this.previewPartService.getBoundingClientRect();
				const croppedScreenShot = await cropImage(screenshot, previewBoundingClientRect);
				widget.attachmentModel.addContext(convertBufferToScreenshotVariable(croppedScreenShot));
			}



			const success = input.executeEdits('addReactComponentSource', [{ range: replaceRange, text: output }]);
			if (success) {
				const variable: IDynamicVariable = {
					id: 'vscode.file',
					range: {
						...replaceRange,
						// Include the actual length of the variable
						startColumn: replaceRange.startColumn + (isLeading ? 0 : 1),
						endColumn: replaceRange.endColumn + displayName.length + (isLeading ? 0 : 1),
					},
					data: { uri: payload.uri, range: payload.range }
				};
				dynamicVariablesModel.addReference(variable);
				input.focus();
			}
		}
	}

	private notifyProjectNotSupported() {
		this.notificationService.prompt(
			Severity.Info,
			localize('aide.devtools.unsupportedProject', 'Your project doesn\'t seem to support React devtooling. You need to client render and have source maps enabled.'),
			[
				{
					label: localize('aide.devtools.openDocumentation', 'Open documentation'),
					run: () => {
						// Construct the external URI to open
						const externalUri = URI.parse('https://docs.aide.dev/experimental/react-devtools/#how-to-use');
						// Use the opener service to open it in the user's browser
						this.openerService.open(externalUri).catch(console.error);
					}
				}
			]
		);
	}

	startInspectingHost(): void {
		this._isInspecting.set(true);
		this._onDidTriggerInspectingHostStart.fire();
	}

	stopInspectingHost(): void {
		this._isInspecting.set(false);
		this._onDidTriggerInspectingHostStop.fire();
	}
}



type CropRectangle = {
	x: number;
	y: number;
	width: number;
	height: number;
};

async function cropImage(buffer: ArrayBufferLike, cropRectangle: CropRectangle): Promise<ArrayBufferLike> {

	const originalBlob = new Blob([buffer]);
	const url = URL.createObjectURL(originalBlob);
	const img = await createImage(url);
	// Clean up
	URL.revokeObjectURL(url);

	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d');

	if (!ctx) {
		throw new Error('Failed to get canvas context');
	}

	// Set canvas dimensions to crop size
	canvas.width = cropRectangle.width;
	canvas.height = cropRectangle.height;

	// Draw the cropped portion
	ctx.drawImage(
		img,
		cropRectangle.x, cropRectangle.y,  // Start at this point
		cropRectangle.width, cropRectangle.height, // Width and height of source rectangle
		0, 0, // Place at canvas origin
		cropRectangle.width, cropRectangle.height // Width and height of destination rectangle
	);

	return originalBlob.arrayBuffer();
}

function createImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			resolve(img);
		};
		img.onerror = reject;
		img.src = src;
	});
}
/*

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob) {
					resolve(blob);
				} else {
					reject(new Error('Failed to create blob'));
				}
			},
			'image/png'  // or 'image/jpeg', etc.
		);
	});
}
*/
