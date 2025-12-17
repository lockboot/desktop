/**
 * Theme Picker - allows users to switch between visual themes.
 */

import type { Desktop } from '../desktop';

interface Theme {
  id: string;
  name: string;
  icon: string;
  emoji?: string;
}

const themes: Theme[] = [
  { id: 'theme-nirvana', name: 'Nirvana', icon: 'background: linear-gradient(135deg, #ff0000 25%, #00ff00 25%, #00ff00 50%, #0000ff 50%, #0000ff 75%, #ffff00 75%)' },
  { id: 'theme-classic', name: 'Cupertino', icon: '', emoji: '⌘' },
  { id: 'theme-mobile', name: 'OLED', icon: 'background: #000; border: 1px solid #333;', emoji: '◐' }
];

let currentThemeId = 'theme-nirvana';
let themePicker: HTMLElement;

function setTheme(themeId: string, desktop: Desktop) {
  const app = document.getElementById('app')!;
  // Remove all theme classes
  themes.forEach(t => app.classList.remove(t.id));
  // Add new theme class
  app.classList.add(themeId);
  currentThemeId = themeId;
  // Store in context
  desktop.context.set('system', { theme: themeId });
  // Update picker UI if open
  updateThemePicker(desktop);
}

function updateThemePicker(desktop: Desktop) {
  if (!themePicker) return;

  themePicker.innerHTML = themes.map(t => `
    <div class="theme-option${t.id === currentThemeId ? ' active' : ''}" data-theme-id="${t.id}">
      <div class="theme-icon" style="${t.icon}">${t.emoji || ''}</div>
      <span>${t.name}</span>
    </div>
  `).join('');

  themePicker.querySelectorAll('.theme-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (opt as HTMLElement).dataset.themeId || '';
      setTheme(id, desktop);
      themePicker.classList.remove('visible');
      desktop.menuManager.close();
    });
  });
}

function showThemePicker(menuItem: HTMLElement, desktop: Desktop) {
  const startMenu = document.getElementById('start-menu')!;
  const startMenuRect = startMenu.getBoundingClientRect();
  const itemRect = menuItem.getBoundingClientRect();
  const desktopEl = document.getElementById('desktop')!;
  const desktopRect = desktopEl.getBoundingClientRect();

  // Account for zoom on mobile
  const appEl = document.getElementById('app')!;
  const zoom = parseFloat(getComputedStyle(appEl).zoom) || 1;

  // Measure theme picker width
  themePicker.style.visibility = 'hidden';
  themePicker.style.display = 'block';
  const pickerWidth = themePicker.offsetWidth;
  themePicker.style.display = '';
  themePicker.style.visibility = '';

  // Check space on right vs left of start menu
  const spaceRight = (desktopRect.right - startMenuRect.right) / zoom;
  const spaceLeft = (startMenuRect.left - desktopRect.left) / zoom;

  let left: number;
  if (spaceRight >= pickerWidth + 4) {
    // Position to the right of start menu
    left = (startMenuRect.right + 2) / zoom;
  } else if (spaceLeft >= pickerWidth + 4) {
    // Position to the left of start menu
    left = (startMenuRect.left - pickerWidth - 2) / zoom;
  } else {
    // Not enough space on either side - clamp to screen
    left = Math.max(0, (desktopRect.width / zoom) - pickerWidth);
  }

  themePicker.style.left = `${left}px`;
  themePicker.style.right = 'auto';

  // For bottom-bar themes (Win95/OLED), align bottom of picker with menu item
  const taskbar = document.getElementById('taskbar')!;
  if (taskbar.getBoundingClientRect().top > window.innerHeight / 2) {
    themePicker.style.bottom = `${(window.innerHeight - itemRect.bottom) / zoom}px`;
    themePicker.style.top = 'auto';
  } else {
    // For top-bar themes (Classic), align top of picker with menu item
    themePicker.style.top = `${itemRect.top / zoom}px`;
    themePicker.style.bottom = 'auto';
  }

  updateThemePicker(desktop);
  themePicker.classList.add('visible');
}

/**
 * Register Theme Picker with the desktop.
 */
export function registerThemePicker(desktop: Desktop): void {
  // Apply default theme on load
  document.getElementById('app')!.classList.add(currentThemeId);

  // Create theme picker element
  themePicker = document.createElement('div');
  themePicker.id = 'theme-picker';
  themePicker.className = 'menu';
  document.getElementById('desktop')!.appendChild(themePicker);

  // Close theme picker when any menu closes
  desktop.menuManager.onClose(() => {
    themePicker.classList.remove('visible');
  });

  // Prevent clicks inside theme picker from closing it
  themePicker.addEventListener('click', e => e.stopPropagation());

  const themeMenuItem = desktop.taskbar.addItem('background: linear-gradient(45deg, #ff0 25%, #0ff 50%, #f0f 75%)', 'Theme ►', () => {
    if (themePicker.classList.contains('visible')) {
      themePicker.classList.remove('visible');
    } else {
      showThemePicker(themeMenuItem, desktop);
    }
  }, true); // keepOpen = true for submenu
}
