/**
 * Unified menu system for consistent behavior across all menus.
 *
 * Features:
 * - Single overlay catches clicks outside menu to close
 * - Only one menu open at a time
 * - Trigger buttons get .menu-open class when menu is open
 * - Smart positioning: auto-detects best position based on available space
 * - Works with any taskbar position (top/bottom) and trigger location
 * - Handles CSS zoom
 */

export type MenuAlign = 'left' | 'right' | 'center' | 'auto';
export type MenuPosition = 'above' | 'below' | 'auto';

export interface MenuOptions {
  /** Horizontal alignment relative to trigger: 'left', 'right', or 'center' */
  align?: MenuAlign;
  /** Vertical position: 'above', 'below', or 'auto' (detect based on space) */
  position?: MenuPosition;
  /** Callback when menu opens (for dynamic content) */
  onOpen?: () => void;
}

export class MenuManager {
  private overlay: HTMLElement;
  private activeMenu: HTMLElement | null = null;
  private activeTrigger: HTMLElement | null = null;
  private closeCallbacks: Set<() => void> = new Set();
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    // Create overlay - covers screen, invisible, catches outside clicks
    // Must be in same container as menus for proper stacking context (zoom creates new context)
    this.overlay = document.createElement('div');
    this.overlay.id = 'menu-overlay';
    container.appendChild(this.overlay);
    this.overlay.addEventListener('click', () => this.close());
  }

  /**
   * Register a callback to be called when any menu closes.
   * Useful for closing submenus.
   */
  onClose(callback: () => void): () => void {
    this.closeCallbacks.add(callback);
    return () => this.closeCallbacks.delete(callback);
  }

  /**
   * Get the current zoom factor from the app element.
   */
  private getZoom(): number {
    const appEl = document.getElementById('app');
    if (!appEl) return 1;
    const styles = getComputedStyle(appEl);
    return parseFloat(styles.zoom) || 1;
  }

  /**
   * Detect if taskbar is at top or bottom by checking its position.
   */
  private isTaskbarAtTop(): boolean {
    const taskbar = document.getElementById('taskbar');
    if (!taskbar) return false;
    const rect = taskbar.getBoundingClientRect();
    return rect.top < window.innerHeight / 2;
  }

  /**
   * Position a menu relative to its trigger with smart positioning.
   * Automatically detects best position based on available space.
   */
  positionMenu(menu: HTMLElement, trigger: HTMLElement, options: MenuOptions = {}): void {
    const { align = 'left', position = 'auto' } = options;
    const zoom = this.getZoom();

    // Get trigger position in zoomed coordinates
    const triggerRect = trigger.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();

    // Convert to container-relative coordinates accounting for zoom
    const triggerLeft = (triggerRect.left - containerRect.left) / zoom;
    const triggerRight = (triggerRect.right - containerRect.left) / zoom;
    const triggerTop = (triggerRect.top - containerRect.top) / zoom;
    const triggerBottom = (triggerRect.bottom - containerRect.top) / zoom;
    const triggerCenterX = (triggerLeft + triggerRight) / 2;

    // Container dimensions in zoomed coordinates
    const containerWidth = containerRect.width / zoom;
    const containerHeight = containerRect.height / zoom;

    // Temporarily show menu to measure it (invisible)
    menu.style.visibility = 'hidden';
    menu.style.display = 'block';
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    menu.style.display = '';
    menu.style.visibility = '';

    // Determine vertical position
    let placeAbove: boolean;
    if (position === 'above') {
      placeAbove = true;
    } else if (position === 'below') {
      placeAbove = false;
    } else {
      // Auto: check available space above vs below
      const spaceAbove = triggerTop;
      const spaceBelow = containerHeight - triggerBottom;
      // Prefer below if taskbar at top, above if taskbar at bottom
      // But override if there's not enough space
      if (this.isTaskbarAtTop()) {
        placeAbove = spaceBelow < menuHeight && spaceAbove >= menuHeight;
      } else {
        placeAbove = spaceAbove >= menuHeight || spaceAbove > spaceBelow;
      }
    }

    // Calculate vertical position
    let top: number;
    if (placeAbove) {
      top = triggerTop - menuHeight;
    } else {
      top = triggerBottom;
    }

    // Calculate horizontal position based on alignment
    let left: number;
    let effectiveAlign = align;

    // Auto-detect alignment based on trigger position
    if (align === 'auto') {
      effectiveAlign = triggerCenterX > containerWidth / 2 ? 'right' : 'left';
    }

    switch (effectiveAlign) {
      case 'right':
        left = triggerRight - menuWidth;
        break;
      case 'center':
        left = triggerCenterX - menuWidth / 2;
        break;
      case 'left':
      default:
        left = triggerLeft;
        break;
    }

    // Clamp to container bounds
    left = Math.max(0, Math.min(left, containerWidth - menuWidth));
    top = Math.max(0, Math.min(top, containerHeight - menuHeight));

    // Apply position
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
  }

  /**
   * Show a menu, closing any currently open menu first.
   * If the same menu+trigger is already active, closes it instead (toggle).
   */
  show(menu: HTMLElement, trigger: HTMLElement, options: MenuOptions = {}): void {
    // Toggle: if same menu and trigger, close
    if (this.activeMenu === menu && this.activeTrigger === trigger) {
      this.close();
      return;
    }

    // Close any open menu first
    this.close();

    // Call onOpen for dynamic content population
    options.onOpen?.();

    // Position the menu
    this.positionMenu(menu, trigger, options);

    // Show the menu
    menu.classList.add('visible');
    trigger.classList.add('menu-open');
    this.overlay.style.display = 'block';

    this.activeMenu = menu;
    this.activeTrigger = trigger;
  }

  /**
   * Close the currently active menu.
   */
  close(): void {
    if (this.activeMenu) {
      this.activeMenu.classList.remove('visible');
    }
    if (this.activeTrigger) {
      this.activeTrigger.classList.remove('menu-open');
    }
    this.overlay.style.display = 'none';
    this.activeMenu = null;
    this.activeTrigger = null;
    // Notify close callbacks (for submenus etc)
    this.closeCallbacks.forEach(cb => cb());
  }

  /**
   * Check if any menu is currently open.
   */
  isOpen(): boolean {
    return this.activeMenu !== null;
  }

  /**
   * Check if a specific menu is currently open.
   */
  isMenuOpen(menu: HTMLElement): boolean {
    return this.activeMenu === menu;
  }
}
