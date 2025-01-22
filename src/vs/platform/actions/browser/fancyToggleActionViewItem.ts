/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { asCSSUrl } from '../../../base/browser/cssValue.js';
import { ModifierKeyEmitter, addDisposableListener } from '../../../base/browser/dom.js';
import { ActionViewItem } from '../../../base/browser/ui/actionbar/actionViewItems.js';
import { IHoverDelegate } from '../../../base/browser/ui/hover/hoverDelegate.js';
import { UILabelProvider } from '../../../base/common/keybindingLabels.js';
import { MutableDisposable, toDisposable, combinedDisposable } from '../../../base/common/lifecycle.js';
import { OS } from '../../../base/common/platform.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { localize } from '../../../nls.js';
import { IAccessibilityService } from '../../accessibility/common/accessibility.js';
import { ICommandAction, isICommandActionToggleInfo } from '../../action/common/action.js';
import { IContextKeyService } from '../../contextkey/common/contextkey.js';
import { IContextMenuService } from '../../contextview/browser/contextView.js';
import { IKeybindingService } from '../../keybinding/common/keybinding.js';
import { INotificationService } from '../../notification/common/notification.js';
import { isDark } from '../../theme/common/theme.js';
import { IThemeService } from '../../theme/common/themeService.js';
import { MenuItemAction } from '../common/actions.js';


export interface IFancyToggleActionViewItemOptions {
	draggable?: boolean;
	keybinding?: string | null;
	hoverDelegate?: IHoverDelegate;
}

export class FancyToggleActionViewItem<T extends IFancyToggleActionViewItemOptions = IFancyToggleActionViewItemOptions> extends ActionViewItem {

	private _wantsAltCommand: boolean = false;
	private readonly _itemClassDispose = this._register(new MutableDisposable());
	private readonly _altKey: ModifierKeyEmitter;

	constructor(
		action: MenuItemAction,
		protected _options: T | undefined,
		@IKeybindingService protected readonly _keybindingService: IKeybindingService,
		@INotificationService protected _notificationService: INotificationService,
		@IContextKeyService protected _contextKeyService: IContextKeyService,
		@IThemeService protected _themeService: IThemeService,
		@IContextMenuService protected _contextMenuService: IContextMenuService,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService
	) {
		super(undefined, action, { icon: !!(action.class || action.item.icon), label: !action.class && !action.item.icon, draggable: _options?.draggable, keybinding: _options?.keybinding, hoverDelegate: _options?.hoverDelegate });
		this._altKey = ModifierKeyEmitter.getInstance();
	}

	protected get _menuItemAction(): MenuItemAction {
		return <MenuItemAction>this._action;
	}

	protected get _commandAction(): MenuItemAction {
		return this._wantsAltCommand && this._menuItemAction.alt || this._menuItemAction;
	}

	override async onClick(event: MouseEvent): Promise<void> {
		event.preventDefault();
		event.stopPropagation();

		try {
			await this.actionRunner.run(this._commandAction, this._context);
		} catch (err) {
			this._notificationService.error(err);
		}
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('fancy-toggle');

		if (this.options.icon) {
			this._updateItemClass(this._menuItemAction.item);
		}

		if (this._menuItemAction.alt) {
			let isMouseOver = false;

			const updateAltState = () => {
				const wantsAltCommand = !!this._menuItemAction.alt?.enabled &&
					(!this._accessibilityService.isMotionReduced() || isMouseOver) && (
						this._altKey.keyStatus.altKey ||
						(this._altKey.keyStatus.shiftKey && isMouseOver)
					);

				if (wantsAltCommand !== this._wantsAltCommand) {
					this._wantsAltCommand = wantsAltCommand;
					this.updateLabel();
					this.updateTooltip();
					this.updateClass();
				}
			};

			this._register(this._altKey.event(updateAltState));

			this._register(addDisposableListener(container, 'mouseleave', _ => {
				isMouseOver = false;
				updateAltState();
			}));

			this._register(addDisposableListener(container, 'mouseenter', _ => {
				isMouseOver = true;
				updateAltState();
			}));

			updateAltState();
		}
	}

	protected override updateLabel(): void {
		if (this.options.label && this.label) {
			this.label.textContent = this._commandAction.label;
		}
	}

	protected override getTooltip() {
		const keybinding = this._keybindingService.lookupKeybinding(this._commandAction.id, this._contextKeyService);
		const keybindingLabel = keybinding && keybinding.getLabel();

		const tooltip = this._commandAction.tooltip || this._commandAction.label;
		let title = keybindingLabel
			? localize('titleAndKb', "{0} ({1})", tooltip, keybindingLabel)
			: tooltip;
		if (!this._wantsAltCommand && this._menuItemAction.alt?.enabled) {
			const altTooltip = this._menuItemAction.alt.tooltip || this._menuItemAction.alt.label;
			const altKeybinding = this._keybindingService.lookupKeybinding(this._menuItemAction.alt.id, this._contextKeyService);
			const altKeybindingLabel = altKeybinding && altKeybinding.getLabel();
			const altTitleSection = altKeybindingLabel
				? localize('titleAndKb', "{0} ({1})", altTooltip, altKeybindingLabel)
				: altTooltip;

			title = localize('titleAndKbAndAlt', "{0}\n[{1}] {2}", title, UILabelProvider.modifierLabels[OS].altKey, altTitleSection);
		}
		return title;
	}

	private _updateItemClass(item: ICommandAction): void {
		const { element, label } = this;
		if (!element || !label) {
			return;
		}

		// Toggle the container's "checked" class
		if (this._commandAction.checked) {
			element.classList.add('fancy-toggle-checked');
		} else {
			element.classList.remove('fancy-toggle-checked');
		}

		// Make sure our label element is the "handle" for the toggle
		label.classList.add('fancy-toggle-handle');

		const icon = this._commandAction.checked && isICommandActionToggleInfo(item.toggled) && item.toggled.icon ? item.toggled.icon : item.icon;
		if (!icon) {
			// No icon to show
			label.style.backgroundImage = '';
			return;
		}

		if (ThemeIcon.isThemeIcon(icon)) {
			// If it's a theme icon, use classes
			const iconClasses = ThemeIcon.asClassNameArray(icon);
			label.classList.add(...iconClasses);

			// Clean up old classes on disposal/re-render
			this._itemClassDispose.value = toDisposable(() => {
				label.classList.remove(...iconClasses);
			});
		} else {
			// If it's a path-based icon, set as background-image
			const themeType = this._themeService.getColorTheme().type;
			const iconPath = isDark(themeType) ? icon.dark : icon.light;
			label.style.backgroundImage = `url(${asCSSUrl(iconPath)})`;

			// Re-apply on theme change
			this._itemClassDispose.value = combinedDisposable(
				toDisposable(() => {
					label.style.backgroundImage = '';
				}),
				this._themeService.onDidColorThemeChange(() => {
					this.updateClass();
				})
			);
		}
	}
}
