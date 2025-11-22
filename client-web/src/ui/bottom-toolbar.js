/**
 * Bottom Toolbar
 * Horizontal toolbar at the bottom of the screen with tabs for different tools
 */

let bottomToolbar = null;
let toolbarState = null;
let activeTab = null;

export function createBottomToolbar() {
  // Check if toolbar DOM actually exists (survives refresh check)
  const existingToolbar = document.getElementById('bottom-toolbar');
  if (existingToolbar && toolbarState) {
    // Toolbar exists and state is valid
    return toolbarState;
  }
  
  // Reset state if DOM doesn't exist (page was refreshed)
  if (!existingToolbar) {
    toolbarState = null;
    bottomToolbar = null;
    activeTab = null;
  }

  bottomToolbar = document.createElement('div');
  bottomToolbar.id = 'bottom-toolbar';
  bottomToolbar.className = 'bottom-toolbar';

  const style = document.createElement('style');
  style.textContent = `
    body {
      margin: 0;
      padding: 0;
      padding-bottom: 100px;
      box-sizing: border-box;
    }
    html, body {
      height: 100%;
      overflow-x: hidden;
    }
    .bottom-toolbar {
      position: fixed;
      bottom: 0px;
      left: 0;
      right: 0;
      width: 100vw;
      height: 100px;
      max-height: 100px;
      background: rgba(17, 17, 17, 0.95);
      border-top: 2px solid #4caf50;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      backdrop-filter: blur(10px);
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.5);
    }
    .zones-toolbar-content {
      display: flex;
      flex-direction: row;
      flex-wrap: nowrap;
      align-items: center;
      width: 100%;
      overflow-x: auto;
      overflow-y: hidden;
    }
    .toolbar-tabs {
      display: flex;
      gap: 0.5rem;
      padding: 0.25rem 0.5rem 0 0.5rem;
      border-bottom: 1px solid #333;
      background: rgba(0, 0, 0, 0.3);
      flex-shrink: 0;
      margin: 0;
    }
    .toolbar-tab {
      padding: 0rem 1rem;
      background: rgba(0, 0, 0, 0.5);
      border: 1px solid #333;
      border-radius: 6px 6px 0 0;
      color: #888;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 500;
      transition: all 0.2s ease;
    }
    .toolbar-tab:hover {
      background: rgba(0, 0, 0, 0.7);
      color: #ccc;
    }
    .toolbar-tab.active {
      background: rgba(76, 175, 80, 0.2);
      border-color: #4caf50;
      color: #4caf50;
      border-bottom-color: transparent;
    }
    .toolbar-content {
      flex: 1;
      display: flex;
      align-items: center;
      flex-wrap: nowrap;
      flex-direction: row;
      padding: 0.5rem 1rem;
      padding-top: 0.25rem;
      gap: 1rem;
      overflow-x: auto;
      overflow-y: hidden;
      min-height: 80px;
      max-height: 80px;
      margin: 0;
    }
    .toolbar-section {
      display: flex;
      align-items: center;
      flex-wrap: nowrap;
      gap: 0.5rem;
      padding: 0 0.75rem;
      border-right: 1px solid #333;
      flex-shrink: 0;
      white-space: nowrap;
    }
    .toolbar-section:last-child {
      border-right: none;
    }
    .toolbar-section-label {
      color: #888;
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      margin-right: 0.5rem;
    }
    .toolbar-button {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.2rem;
      padding: 0.35rem 0.4rem;
      min-width: 50px;
      max-width: 50px;
      background: rgba(0, 0, 0, 0.5);
      border: 2px solid #333;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
      color: #ccc;
      flex-shrink: 0;
      white-space: nowrap;
    }
    .toolbar-button:hover {
      border-color: #4caf50;
      background: rgba(76, 175, 80, 0.1);
      color: #4caf50;
    }
    .toolbar-button.active {
      border-color: #4caf50;
      background: rgba(76, 175, 80, 0.2);
      color: #4caf50;
    }
    .toolbar-button-icon {
      font-size: 1.3rem;
      line-height: 1;
    }
    .toolbar-button-label {
      font-size: 0.65rem;
      font-weight: 500;
      text-align: center;
      line-height: 1;
    }
    .toolbar-info {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      color: #888;
      font-size: 0.85rem;
    }
    .toolbar-info-value {
      color: #4caf50;
      font-weight: 600;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(bottomToolbar);

  // Create tabs container
  const tabsContainer = document.createElement('div');
  tabsContainer.className = 'toolbar-tabs';
  
  // Create content container
  const contentContainer = document.createElement('div');
  contentContainer.className = 'toolbar-content';
  contentContainer.id = 'toolbar-content';

  bottomToolbar.appendChild(tabsContainer);
  bottomToolbar.appendChild(contentContainer);

  toolbarState = {
    toolbar: bottomToolbar,
    tabsContainer,
    contentContainer,
  };

  return toolbarState;
}

export function createTab(name, id) {
  const tab = document.createElement('div');
  tab.className = 'toolbar-tab';
  tab.id = `tab-${id}`;
  tab.textContent = name;
  tab.setAttribute('data-tab-id', id);
  
  tab.addEventListener('click', () => {
    switchTab(id);
  });

  return tab;
}

export function switchTab(tabId) {
  // Update tab states
  const tabs = document.querySelectorAll('.toolbar-tab');
  tabs.forEach(tab => {
    if (tab.getAttribute('data-tab-id') === tabId) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  activeTab = tabId;
  
  // Persist active tab to localStorage
  try {
    localStorage.setItem('earthring_active_tab', tabId);
  } catch (e) {
    // Ignore localStorage errors (e.g., private browsing)
  }
  
  // Dispatch event for tab change
  window.dispatchEvent(new CustomEvent('toolbar:tab-changed', { detail: { tabId } }));
}

export function getActiveTab() {
  // Try to restore from localStorage
  try {
    const savedTab = localStorage.getItem('earthring_active_tab');
    if (savedTab) {
      return savedTab;
    }
  } catch (e) {
    // Ignore localStorage errors
  }
  return activeTab;
}

export function addTab(name, id) {
  const toolbar = createBottomToolbar();
  const tab = createTab(name, id);
  toolbar.tabsContainer.appendChild(tab);
  
  // Set first tab as active, or restore from localStorage
  if (!activeTab) {
    const savedTab = getActiveTab();
    if (savedTab && document.querySelector(`[data-tab-id="${savedTab}"]`)) {
      switchTab(savedTab);
    } else {
      switchTab(id);
    }
  }
  
  return tab;
}

export function setTabContent(tabId, content) {
  const toolbar = createBottomToolbar();
  if (activeTab === tabId) {
    toolbar.contentContainer.innerHTML = '';
    if (content) {
      toolbar.contentContainer.appendChild(content);
    }
  }
}

export function getToolbarContent() {
  const toolbar = createBottomToolbar();
  return toolbar.contentContainer;
}

