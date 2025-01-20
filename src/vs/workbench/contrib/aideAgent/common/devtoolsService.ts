/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { Location } from '../../../../editor/common/languages.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IDevtoolsService = createDecorator<IDevtoolsService>('IDevtoolsService');
export interface IDevtoolsService {
	_serviceBrand: undefined;
	status: DevtoolsStatus;
	initialize(): void;
	startInspectingHost(): void;
	stopInspectingHost(): void;
	onDidTriggerInspectingHostStart: Event<void>;
	onDidTriggerInspectingHostStop: Event<void>;
	isInspecting: boolean;
	latestPayload: Location | null;
	latestResource: URI | undefined;
}

export enum DevtoolsStatus {
	ServerConnected = 'server-connected',
	DevtoolsConnected = 'devtools-connected',
	Error = 'error',
	Idle = 'idle'
}

export type DevtoolsStatusType = `${DevtoolsStatus}`;

export type ParsedSource = {
	line: number;
	column: number;
	source: ParsedSourceData;
};

export type ParsedSourceURLData = {
	type: 'URL';
	url: string;
	relativePath: string;
};

export type ParsedSourceAbsoluteData = {
	type: 'absolute';
	path: string;
};

export type ParsedSourceRelativeData = {
	type: 'relative';
	path: string;
};

export type ParsedSourceData =
	| ParsedSourceAbsoluteData
	| ParsedSourceRelativeData
	| ParsedSourceURLData;

