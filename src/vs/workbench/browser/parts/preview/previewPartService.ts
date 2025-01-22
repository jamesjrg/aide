/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IPreviewPartService } from '../../../services/previewPart/browser/previewPartService.js';
import { MultiWindowParts } from '../../part.js';
import { IEditorPartsView } from '../editor/editor.js';
import { IEditorPartUIState } from '../editor/editorPart.js';
import { PreviewEditorPart } from './previewPart.js';

export class PreviewPartService extends MultiWindowParts<PreviewEditorPart> implements IPreviewPartService {
	declare _serviceBrand: undefined;

	readonly mainPart = this._register(this.instantiationService.createInstance(PreviewEditorPart));

	constructor(
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@IThemeService themeService: IThemeService,
	) {
		super('workbench.previewPartService', themeService, storageService);

		this._register(this.registerPart(this.mainPart));
	}

	getOrCreateEditorGroupPart(editorPartsView: IEditorPartsView, state?: IEditorPartUIState) {
		return this.mainPart.getOrCreateEditorPart(editorPartsView, state);
	}

	/*
	// TODO: @g-danna remove unnecessary stuff
	async openPreview(editor: EditorInput | IUntypedEditorInput, optionsOrPreferredGroup?: IEditorOptions | PreferredGroup, preferredGroup?: PreferredGroup): Promise<IEditorPane | undefined> {
		let typedEditor: EditorInput | undefined = undefined;
		let options = isEditorInput(editor) ? optionsOrPreferredGroup as IEditorOptions : editor.options;
		let group: IEditorGroup | undefined = undefined;

		if (isPreferredGroup(optionsOrPreferredGroup)) {
			preferredGroup = optionsOrPreferredGroup;
		}

		// Resolve override unless disabled
		if (!isEditorInput(editor)) {
			const resolvedEditor = await this.editorResolverService.resolveEditor(editor, preferredGroup);

			if (resolvedEditor === ResolvedStatus.ABORT) {
				return; // skip editor if override is aborted
			}

			// We resolved an editor to use
			if (isEditorInputWithOptionsAndGroup(resolvedEditor)) {
				typedEditor = resolvedEditor.editor;
				options = resolvedEditor.options;
				group = resolvedEditor.group;
			}
		}

		// @g-danna I will need to reuse this logic for my overlay preview service

		// Override is disabled or did not apply: fallback to default
		if (!typedEditor) {
			typedEditor = isEditorInput(editor) ? editor : await this.textEditorService.resolveTextEditor(editor);
		}

		// If group still isn't defined because of a disabled override we resolve it
		if (!group) {
			let activation: EditorActivation | undefined = undefined;
			// TODO: @g-danna edit findGroup method
			const findGroupResult = this.instantiationService.invokeFunction(findGroup, { editor: typedEditor, options }, preferredGroup);
			if (findGroupResult instanceof Promise) {
				([group, activation] = await findGroupResult);
			} else {
				([group, activation] = findGroupResult);
			}

			// Mixin editor group activation if returned
			if (activation) {
				options = { ...options, activation };
			}
		}

		return group.openEditor(typedEditor, options);
	}*/


	// createAuxiliaryPreviewPart(container: HTMLElement, editorContainer: HTMLElement): PreviewPart {
	// const previewPartContainer = document.createElement('div');
	// const previewPart = this.instantiationService.createInstance(PreviewPart);
	// this._register(previewPart);
	// previewPartContainer.classList.add('part', 'bottombar-part');
	// container.insertBefore(previewPartContainer, editorContainer.nextSibling);
	// return previewPart;
	// }

}
