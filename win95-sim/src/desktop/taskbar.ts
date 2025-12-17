/**
 * Taskbar - handles start menu, clock, and taskbar items.
 */

import { MenuManager } from '../menu';

export class Taskbar {
  private startMenu: HTMLElement;
  private startBtn: HTMLElement;
  private menuManager: MenuManager;

  constructor(menuManager: MenuManager) {
    this.menuManager = menuManager;
    this.startMenu = document.getElementById('start-menu')!;
    this.startBtn = document.getElementById('start-button')!;

    // Add menu class for unified styling
    this.startMenu.classList.add('menu');

    this.startBtn.addEventListener('click', e => {
      e.stopPropagation();
      this.menuManager.show(this.startMenu, this.startBtn, { align: 'auto' });
    });

    this.startClock();
  }

  private startClock() {
    const update = () => {
      const now = new Date();
      const h = now.getHours() % 12 || 12;
      const m = now.getMinutes().toString().padStart(2, '0');
      document.getElementById('clock')!.textContent = `${h}:${m} ${now.getHours() >= 12 ? 'PM' : 'AM'}`;
    };
    update();
    setInterval(update, 1000);
  }

  addItem(icon: string, label: string, action: () => void, keepOpen = false) {
    const items = document.getElementById('start-menu-items')!;
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.innerHTML = `<div class="icon" style="${icon}"></div><span>${label}</span>`;
    item.addEventListener('click', e => {
      e.stopPropagation();
      action();
      if (!keepOpen) {
        this.menuManager.close();
      }
    });
    items.insertBefore(item, items.querySelector('.menu-separator'));
    return item;
  }
}
