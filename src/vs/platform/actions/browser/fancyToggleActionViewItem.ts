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

	private _container: HTMLElement | undefined;
	private _label: HTMLElement | undefined;

	protected get _menuItemAction(): MenuItemAction {
		return <MenuItemAction>this._action;
	}

	private static readonly lastCheckedState = new Map<string, boolean>();

	constructor(
		context: unknown,
		action: MenuItemAction,
		private readonly _options: IFancyToggleActionViewItemOptions | undefined,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IThemeService private readonly _themeService: IThemeService,
	) {
		super(context, action, _options);
		// If you also want a custom ActionRunner, set it here:
		this.actionRunner = new ActionRunner();
	}

	// Create DOM elements exactly once and attach them to "container"
	override render(container: HTMLElement): void {

		this._container = container;
		container.classList.add('fancy-toggle');


		// Create a child <a> to act as our "handle" or clickable label
		const label = document.createElement('a');
		label.classList.add('action-label', 'fancy-toggle-handle');
		// Use "button" or "checkbox" role for toggles (depending on your exact need)
		label.setAttribute('role', 'checkbox');
		label.tabIndex = -1; // setFocusable() will manage this

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

		// If you want to handle mouseenter/leave or altKey toggling, do so here
		// e.g.: this._setupAltCommandListeners();
		// for brevity, omitted.

		// Sync initial state
		this._updateAll();

		this._applyInitialCheckedStateForTransition();
		super.render(container);

		// (Optional) Also watch for changes in the theme
		this._register(this._themeService.onDidColorThemeChange(() => this._updateAll()));

	}

	// Implement the same focus/blur logic as ActionViewItem for keyboard accessibility
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

	// Like ActionViewItem, run the action on click, handle errors
	override async onClick(event: MouseEvent): Promise<void> {
		if (!this.action.enabled) {
			return;
		}
		super.onClick(event);
	}

	// Gather and apply all state: label text, tooltip, enabled, checked, icons, etc
	private _updateAll(): void {
		if (!this._container || !this._label) {
			return;
		}

		// Update label text
		this._label.textContent = this.action.label;
		// Or if you have alt commands, choose whichever label is relevant

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

		// Update "checked" state
		// For toggleable actions, set role=checkbox + aria-checked
		if (this.action.checked === true || this.action.checked === false) {
			this._label.setAttribute('role', 'checkbox');
			this._label.setAttribute('aria-checked', this.action.checked ? 'true' : 'false');
			this._container.classList.toggle('fancy-toggle-checked', !!this.action.checked);
		} else {
			// If not a toggle, revert to normal button role
			this._label.setAttribute('role', 'button');
			this._label.removeAttribute('aria-checked');
			this._container.classList.remove('fancy-toggle-checked');
		}

		// If you have a toggled icon vs. normal icon, handle it here
		this._updateIcon();
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

	private _updateIcon(): void {
		if (!this._label || !this._container) {
			return;
		}

		const actionItem = this._menuItemAction.item;
		if (!actionItem) {
			return;
		}

		// Possibly remove old dynamic classes:
		this._itemClassDispose.value = undefined;
		this._label.style.backgroundImage = '';

		// Show toggled.icon if checked and if toggled info is present, else show normal icon
		const icon =
			this.action.checked &&
				isICommandActionToggleInfo(actionItem.toggled) &&
				actionItem.toggled.icon
				? actionItem.toggled.icon
				: actionItem.icon;
		if (!icon) {
			return; // no icon
		}

		// If it's a theme icon, use classes
		if (ThemeIcon.isThemeIcon(icon)) {
			const iconClasses = ThemeIcon.asClassNameArray(icon);
			this._label.classList.add(...iconClasses);

			// Clean up old classes on disposal
			this._itemClassDispose.value = toDisposable(() => {
				this._label?.classList.remove(...iconClasses);
			});
		} else {
			// If it's a path-based icon, set it as background-image
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
				this._themeService.onDidColorThemeChange(() => this._updateIcon())
			);
		}
	}

	private _applyInitialCheckedStateForTransition(): void {
		if (!this._container || !this._label) {
			return;
		}

		const oldChecked = FancyToggleActionViewItem.lastCheckedState.get(this.action.id);
		const newChecked = !!this.action.checked;

		if (oldChecked === undefined) {
			// First time seeing this action.id, no transition needed
			// (or you could default it to some known state)
			return;
		}

		if (oldChecked !== newChecked) {
			// They differ, so "fake" a transition from the old state to the new state
			// by first forcing the old state on our DOM...
			this._forceCheckedVisual(oldChecked);

			// Then wait a tick and re-apply the real/new checked state to see the toggle animate
			getWindow(this._container).requestAnimationFrame(() => {
				this._forceCheckedVisual(newChecked);
			});
		}
	}

	// Helper to force a .checked state visually without changing this.action
	private _forceCheckedVisual(isChecked: boolean): void {
		this._container!.classList.toggle('fancy-toggle-checked', isChecked);
		this._label!.setAttribute('aria-checked', String(isChecked));
		// Any other DOM manipulations (such as handle position or icon) that you do in _updateAll()
		// could be repeated here to sync the "fake" state.
	}


	override dispose() {
		FancyToggleActionViewItem.lastCheckedState.set(this.action.id, !!this.action.checked);
		super.dispose();
	}
}
