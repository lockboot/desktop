/**
 * Programs Menu - displays available packages grouped by type.
 *
 * Features:
 * - Loads packages from packages.json
 * - Groups by meta.type (compiler, game, shell, etc.)
 * - Click to open a new workspace with the package on A:
 * - Drag packages to workspace drives
 */

import type { Desktop } from '../desktop';
import { fetchAvailablePackages, type PackageInfo } from '../cpm/workspace';

let programsMenu: HTMLElement;
let packagesCache: PackageInfo[] | null = null;

// Type display names and icons
const TYPE_CONFIG: Record<string, { name: string; icon: string }> = {
  compiler: { name: 'Development', icon: 'background: #4a4; border: 1px solid #2a2;' },
  development: { name: 'Development', icon: 'background: #4a4; border: 1px solid #2a2;' },
  game: { name: 'Games', icon: 'background: #a44; border: 1px solid #622;' },
  shell: { name: 'System', icon: 'background: #44a; border: 1px solid #226;' },
  system: { name: 'System', icon: 'background: #44a; border: 1px solid #226;' },
  utilities: { name: 'Utilities', icon: 'background: #aa4; border: 1px solid #662;' },
};

/**
 * Get packages, using cache if available.
 */
async function getPackages(): Promise<PackageInfo[]> {
  if (packagesCache) return packagesCache;
  packagesCache = await fetchAvailablePackages();
  return packagesCache;
}

/**
 * Group packages by type.
 */
function groupByType(packages: PackageInfo[]): Map<string, PackageInfo[]> {
  const groups = new Map<string, PackageInfo[]>();

  for (const pkg of packages) {
    // Normalize type - merge similar types
    let type = pkg.type?.toLowerCase() || '';
    if (type === 'compiler') type = 'development';
    if (type === 'shell') type = 'system';

    if (!groups.has(type)) {
      groups.set(type, []);
    }
    groups.get(type)!.push(pkg);
  }

  // Sort packages within each group
  for (const pkgs of groups.values()) {
    pkgs.sort((a, b) => a.name.localeCompare(b.name));
  }

  return groups;
}

/**
 * Create a menu item element.
 */
function createMenuItem(
  label: string,
  icon: string,
  onClick?: () => void,
  isFolder = false,
  packageId?: string
): HTMLElement {
  const item = document.createElement('div');
  item.className = 'menu-item' + (isFolder ? ' has-submenu' : '');
  item.innerHTML = `
    <div class="icon" style="${icon}"></div>
    <span>${label}</span>
    ${isFolder ? '<span class="submenu-arrow">►</span>' : ''}
  `;

  if (onClick) {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
  }

  // Add drag support for packages
  if (packageId) {
    item.draggable = true;
    item.dataset.packageId = packageId;
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('application/x-cpm-package', packageId);
      e.dataTransfer?.setData('text/plain', packageId);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'copy';
      }
    });
  }

  return item;
}

/**
 * Build the programs menu content.
 */
async function buildMenuContent(desktop: Desktop): Promise<void> {
  const packages = await getPackages();
  const groups = groupByType(packages);

  programsMenu.innerHTML = '';

  // Sort group keys: known types first, then unknown, then empty (no type)
  const sortedTypes = Array.from(groups.keys()).sort((a, b) => {
    if (!a) return 1;  // Empty type goes last
    if (!b) return -1;
    const aKnown = a in TYPE_CONFIG;
    const bKnown = b in TYPE_CONFIG;
    if (aKnown && !bKnown) return -1;
    if (!aKnown && bKnown) return 1;
    return a.localeCompare(b);
  });

  // Add folders for each type
  for (const type of sortedTypes) {
    if (!type) continue; // Skip untyped for now, add at bottom

    const pkgs = groups.get(type)!;
    const config = TYPE_CONFIG[type] || { name: type.charAt(0).toUpperCase() + type.slice(1), icon: 'background: #888;' };

    // Create folder item
    const folderItem = createMenuItem(config.name, config.icon, undefined, true);

    // Create submenu
    const submenu = document.createElement('div');
    submenu.className = 'submenu menu';

    for (const pkg of pkgs) {
      const pkgItem = createMenuItem(pkg.name, config.icon, () => {
        openWorkspaceWithPackage(desktop, pkg.id);
        desktop.menuManager.close();
      }, false, pkg.id);
      pkgItem.title = pkg.description || pkg.name;
      submenu.appendChild(pkgItem);
    }

    folderItem.appendChild(submenu);
    programsMenu.appendChild(folderItem);

    // Show submenu on hover
    folderItem.addEventListener('mouseenter', () => {
      // Hide other submenus
      programsMenu.querySelectorAll('.submenu.visible').forEach(s => s.classList.remove('visible'));
      submenu.classList.add('visible');
      positionSubmenu(folderItem, submenu);
    });
  }

  // Add separator if we have typed items and untyped items
  const untypedPkgs = groups.get('') || [];
  if (sortedTypes.some(t => t) && untypedPkgs.length > 0) {
    const sep = document.createElement('div');
    sep.className = 'menu-separator';
    programsMenu.appendChild(sep);
  }

  // Add untyped packages at bottom (not in a folder)
  for (const pkg of untypedPkgs) {
    const pkgItem = createMenuItem(pkg.name, 'background: #888;', () => {
      openWorkspaceWithPackage(desktop, pkg.id);
      desktop.menuManager.close();
    }, false, pkg.id);
    pkgItem.title = pkg.description || pkg.name;
    programsMenu.appendChild(pkgItem);
  }
}

/**
 * Position a submenu relative to its parent item.
 */
function positionSubmenu(_parentItem: HTMLElement, submenu: HTMLElement): void {
  const menuRect = programsMenu.getBoundingClientRect();
  const desktopEl = document.getElementById('desktop')!;
  const desktopRect = desktopEl.getBoundingClientRect();

  // Get zoom factor
  const appEl = document.getElementById('app')!;
  const zoom = parseFloat(getComputedStyle(appEl).zoom) || 1;

  // Measure submenu
  submenu.style.visibility = 'hidden';
  submenu.style.display = 'block';
  const submenuWidth = submenu.offsetWidth;
  submenu.style.display = '';
  submenu.style.visibility = '';

  // Check space on right vs left
  const spaceRight = (desktopRect.right - menuRect.right) / zoom;
  const spaceLeft = (menuRect.left - desktopRect.left) / zoom;

  if (spaceRight >= submenuWidth + 4) {
    submenu.style.left = '100%';
    submenu.style.right = 'auto';
  } else if (spaceLeft >= submenuWidth + 4) {
    submenu.style.right = '100%';
    submenu.style.left = 'auto';
  } else {
    submenu.style.left = '100%';
  }

  // Vertical position - align with parent item
  submenu.style.top = '0';
}

/**
 * Open a new workspace with the specified package on A: drive.
 */
async function openWorkspaceWithPackage(desktop: Desktop, packageId: string): Promise<void> {
  // Import workspace manager dynamically to avoid circular deps
  const { openWorkspaceWithPackage: openWs } = await import('./workspace-manager');
  await openWs(desktop, packageId);
}

/**
 * Show the programs menu.
 */
function showProgramsMenu(menuItem: HTMLElement, desktop: Desktop): void {
  // Notify other submenus to close
  document.dispatchEvent(new CustomEvent('submenu-open', { detail: { id: 'programs' } }));
  const startMenu = document.getElementById('start-menu')!;
  const startMenuRect = startMenu.getBoundingClientRect();
  const desktopEl = document.getElementById('desktop')!;
  const desktopRect = desktopEl.getBoundingClientRect();

  const appEl = document.getElementById('app')!;
  const zoom = parseFloat(getComputedStyle(appEl).zoom) || 1;

  // Build content (async but we show immediately with loading state)
  buildMenuContent(desktop);

  // Measure menu
  programsMenu.style.visibility = 'hidden';
  programsMenu.style.display = 'block';
  const menuWidth = programsMenu.offsetWidth;
  programsMenu.style.display = '';
  programsMenu.style.visibility = '';

  // Position to the right of start menu
  const spaceRight = (desktopRect.right - startMenuRect.right) / zoom;
  const spaceLeft = (startMenuRect.left - desktopRect.left) / zoom;

  let left: number;
  if (spaceRight >= menuWidth + 4) {
    left = (startMenuRect.right + 2) / zoom;
  } else if (spaceLeft >= menuWidth + 4) {
    left = (startMenuRect.left - menuWidth - 2) / zoom;
  } else {
    left = Math.max(0, (desktopRect.width / zoom) - menuWidth);
  }

  programsMenu.style.left = `${left}px`;
  programsMenu.style.right = 'auto';

  // Vertical positioning
  const itemRect = menuItem.getBoundingClientRect();
  const taskbar = document.getElementById('taskbar')!;
  if (taskbar.getBoundingClientRect().top > window.innerHeight / 2) {
    programsMenu.style.bottom = `${(window.innerHeight - itemRect.bottom) / zoom}px`;
    programsMenu.style.top = 'auto';
  } else {
    programsMenu.style.top = `${itemRect.top / zoom}px`;
    programsMenu.style.bottom = 'auto';
  }

  programsMenu.classList.add('visible');
}

/**
 * Register the Programs menu with the desktop.
 */
export function registerProgramsMenu(desktop: Desktop): void {
  // Create menu element
  programsMenu = document.createElement('div');
  programsMenu.id = 'programs-menu';
  programsMenu.className = 'menu programs-menu';
  document.getElementById('desktop')!.appendChild(programsMenu);

  // Close menu when any menu closes
  desktop.menuManager.onClose(() => {
    programsMenu.classList.remove('visible');
    programsMenu.querySelectorAll('.submenu.visible').forEach(s => s.classList.remove('visible'));
  });

  // Close when clicking anywhere outside the programs menu
  document.addEventListener('mousedown', (e) => {
    if (!programsMenu.classList.contains('visible')) return;
    if (programsMenu.contains(e.target as Node)) return;
    // Also allow clicks on the start menu items
    const startMenu = document.getElementById('start-menu');
    if (startMenu?.contains(e.target as Node)) return;
    programsMenu.classList.remove('visible');
    programsMenu.querySelectorAll('.submenu.visible').forEach(s => s.classList.remove('visible'));
  });

  // Close when another submenu opens
  document.addEventListener('submenu-open', ((e: CustomEvent) => {
    if (e.detail.id !== 'programs') {
      programsMenu.classList.remove('visible');
      programsMenu.querySelectorAll('.submenu.visible').forEach(s => s.classList.remove('visible'));
    }
  }) as EventListener);

  // Prevent clicks inside from closing
  programsMenu.addEventListener('click', e => e.stopPropagation());

  // Add to start menu
  const programsMenuItem = desktop.taskbar.addItem(
    'background: linear-gradient(135deg, #4a4 0%, #44a 50%, #a44 100%);',
    'Programs ►',
    () => {
      if (programsMenu.classList.contains('visible')) {
        programsMenu.classList.remove('visible');
      } else {
        showProgramsMenu(programsMenuItem, desktop);
      }
    },
    true // keepOpen for submenu
  );

  // Preload packages
  getPackages();
}
