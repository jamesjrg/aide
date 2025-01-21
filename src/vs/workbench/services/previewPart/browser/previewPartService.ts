/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { PreviewPart } from '../../../browser/parts/preview/previewPart.js';
import { IUntypedEditorInput, IEditorPane } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { PreferredGroup } from '../../editor/common/editorService.js';

export const IPreviewPartService = createDecorator<IPreviewPartService>('previewPartService');

export interface IPreviewPartService {

	readonly _serviceBrand: undefined;
	readonly mainPart: PreviewPart;
	getPart(container: HTMLElement): IDisposable; // Should be getOverlayedPart ?
	openPreview(editor: EditorInput | IUntypedEditorInput, optionsOrPreferredGroup?: IEditorOptions | PreferredGroup, preferredGroup?: PreferredGroup): Promise<IEditorPane | undefined>;
	// createAuxiliaryPreviewPart(container: HTMLElement, editorsContainer: HTMLElement): PreviewPart;
}
