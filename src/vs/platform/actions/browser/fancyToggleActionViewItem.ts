/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseActionViewItem } from '../../../base/browser/ui/actionbar/actionViewItems.js';
import { addDisposableListener, EventType, getWindow } from '../../../base/browser/dom.js';
import { IHoverDelegate } from '../../../base/browser/ui/hover/hoverDelegate.js';
import { IKeybindingService } from '../../keybinding/common/keybinding.js';
import { IContextKeyService } from '../../contextkey/common/contextkey.js';
import { IThemeService } from '../../theme/common/themeService.js';
import { localize } from '../../../nls.js';
import { MenuItemAction } from '../common/actions.js';
import { isICommandActionToggleInfo } from '../../action/common/action.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { combinedDisposable, MutableDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { isDark } from '../../theme/common/theme.js';
import { asCSSUrl } from '../../../base/browser/cssValue.js';
import { ActionRunner } from '../../../base/common/actions.js';
import './fancyToggleActionViewItem.css';

export interface IFancyToggleActionViewItemOptions {
	draggable?: boolean;
	keybinding?: string | null;
	hoverDelegate?: IHoverDelegate;
}

export class FancyToggleActionViewItem extends BaseActionViewItem {

	private readonly _itemClassDispose = this._register(new MutableDisposable());
	private _container!: HTMLElement;
	private _label!: HTMLElement;

	// Keep track of each action's last-known "checked" state
	private static readonly lastCheckedState = new Map<string, boolean>();

	protected get _menuItemAction(): MenuItemAction {
		return <MenuItemAction>this._action;
	}

	constructor(
		context: unknown,
		action: MenuItemAction,
		private readonly _options: IFancyToggleActionViewItemOptions | undefined,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IThemeService private readonly _themeService: IThemeService,
	) {
		super(context, action, _options);

		// (Optional) use custom ActionRunner
		this.actionRunner = new ActionRunner();
	}

	override render(container: HTMLElement): void {
		this._container = container;
		container.classList.add('fancy-toggle');

		// Create the "handle" <a>
		const label = document.createElement('a');
		label.classList.add('action-label', 'fancy-toggle-handle');
		label.setAttribute('role', 'checkbox');
		label.tabIndex = -1;
		this._label = label;
		container.appendChild(label);

		// Listen for clicks
		this._register(
			addDisposableListener(label, EventType.CLICK, e => {
				e.preventDefault();
				e.stopPropagation();
				this.onClick(e);
			})
		);

		// Set initial final state (i.e. new checked or unchecked)
		this._updateInformation();

		// Then see if we can animate from the old state to the new:
		this._applyInitialCheckedStateForTransition();

		super.render(container);

		// Watch for theme changes
		this._register(this._themeService.onDidColorThemeChange(() => this._updateInformation()));
	}

	override focus(): void {
		if (this._label) {
			this._label.tabIndex = 0;
			this._label.focus();
		}
	}

	override blur(): void {
		if (this._label) {
			this._label.tabIndex = -1;
			this._label.blur();
		}
	}

	override isFocused(): boolean {
		return !!this._label && this._label?.tabIndex === 0;
	}

	override setFocusable(focusable: boolean): void {
		if (this._label) {
			this._label.tabIndex = focusable ? 0 : -1;
		}
	}

	override async onClick(event: MouseEvent): Promise<void> {
		if (!this.action.enabled) {
			return;
		}
		super.onClick(event);
	}

	// Update label, tooltip, aria-checked, and other final state
	private _updateInformation(): void {
		if (!this._container || !this._label) {
			return;
		}

		// Update label text
		this._label.textContent = this.action.label;

		// Update tooltip
		const tooltip = this._getTooltip();
		if (tooltip) {
			this._label.title = tooltip;
			this._label.setAttribute('aria-label', tooltip);
		} else {
			this._label.removeAttribute('title');
			this._label.removeAttribute('aria-label');
		}

		// Update enabled
		if (this.action.enabled) {
			this._label.classList.remove('disabled');
			this._label.removeAttribute('aria-disabled');
		} else {
			this._label.classList.add('disabled');
			this._label.setAttribute('aria-disabled', 'true');
		}
		// Styles will be updated later
	}

	private _getTooltip(): string | undefined {
		const keybinding = this._options?.keybinding
			? this._keybindingService.lookupKeybinding(this.action.id, this._contextKeyService)
			: undefined;

		let tooltip = this.action.tooltip || this.action.label;
		if (tooltip && keybinding) {
			const kbLabel = keybinding.getLabel();
			if (kbLabel) {
				tooltip = localize('titleAndKb', '{0} ({1})', tooltip, kbLabel);
			}
		}
		return tooltip || undefined;
	}

	private _updateStyles(checked: boolean) {
		if (checked === true || checked === false) {
			this._label.setAttribute('role', 'checkbox');
			this._label.setAttribute('aria-checked', checked ? 'true' : 'false');
			this._container.classList.toggle('fancy-toggle-checked', !!checked);
		} else {
			// Not a toggle
			this._label.setAttribute('role', 'button');
			this._label.removeAttribute('aria-checked');
			this._container.classList.remove('fancy-toggle-checked');
		}

		this._updateIcon(checked);
	}

	private _updateIcon(checked: boolean): void {
		if (!this._label || !this._container) {
			return;
		}

		const actionItem = this._menuItemAction.item;
		if (!actionItem) {
			return;
		}

		// Remove old dynamic classes
		this._itemClassDispose.value = undefined;
		this._label.style.backgroundImage = '';

		// Show toggled icon if checked and toggled info is present, else normal icon
		const icon =
			checked &&
				isICommandActionToggleInfo(actionItem.toggled) &&
				actionItem.toggled.icon
				? actionItem.toggled.icon
				: actionItem.icon;

		if (!icon) {
			return; // No icon
		}

		if (ThemeIcon.isThemeIcon(icon)) {
			const iconClasses = ThemeIcon.asClassNameArray(icon);
			this._label.classList.add(...iconClasses);

			// Clean up old classes on dispose
			this._itemClassDispose.value = toDisposable(() => {
				this._label?.classList.remove(...iconClasses);
			});
		} else {
			// If it's a path-based icon
			const themeType = this._themeService.getColorTheme().type;
			const iconPath = isDark(themeType) ? icon.dark : icon.light;
			this._label.style.backgroundImage = `url(${asCSSUrl(iconPath)})`;

			// Re-apply on theme change
			this._itemClassDispose.value = combinedDisposable(
				toDisposable(() => {
					if (this._label) {
						this._label.style.backgroundImage = '';
					}
				}),
				this._themeService.onDidColorThemeChange(() => {
					this._updateIcon(this.action.checked || false);
				})
			);
		}
	}

	private _applyInitialCheckedStateForTransition(): void {
		if (!this._container || !this._label) {
			return;
		}

		const oldChecked = FancyToggleActionViewItem.lastCheckedState.get(this.action.id);
		const newChecked = !!this.action.checked;

		// If first time or no change, do nothing
		if (oldChecked === undefined || oldChecked === newChecked) {
			return;
		}

		// Force old visuals
		this._updateStyles(oldChecked);

		// Then animate to the new state in the next frame
		getWindow(this._container).requestAnimationFrame(() => {
			getWindow(this._container).requestAnimationFrame(() => {
				this._updateStyles(newChecked);
			});
		});
	}

	// On dispose, remember the final state
	override dispose(): void {
		FancyToggleActionViewItem.lastCheckedState.set(this.action.id, !!this.action.checked);
		super.dispose();
	}
}
