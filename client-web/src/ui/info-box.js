/**
 * Info Box Component
 * Permanent box in bottom right for selected item info and game notifications
 */

let infoBox = null;
let isResizeLocked = false;
let userHeight = null; // User's preferred height (null = auto)
let isResizing = false;
let lastUpdateSource = 'init';
let lastUpdateTime = 0;

/**
 * Create and show the info box
 */
export function createInfoBox() {
  if (infoBox) {
    return infoBox; // Already exists
  }

  infoBox = document.createElement('div');
  infoBox.id = 'info-box';

  const style = document.createElement('style');
  style.textContent = `
    #info-box {
      position: fixed;
      bottom: 100px; /* Flush with toolbar top */
      right: 0px; /* Flush with right edge */
      width: 300px;
      max-height: 300px;
      background: rgba(17, 17, 17, 0.95);
      border: 2px solid #4caf50;
      border-bottom: none;
      border-right: none;
      border-top-left-radius: 8px;
      border-top-right-radius: 0;
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      padding: 15px;
      padding-top: 20px; /* Extra padding at top for resize handle */
      font-family: 'Courier New', monospace;
      font-size: 12px;
      color: #00ff00;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(10px);
    }

    .info-box-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(0, 255, 0, 0.3);
    }

    .info-box-title {
      color: #00ff00;
      font-size: 14px;
      font-weight: bold;
      position: relative;
      cursor: help;
    }

    .info-box-title[data-tooltip]:hover::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      margin-bottom: 5px;
      padding: 6px 10px;
      background: rgba(0, 0, 0, 0.95);
      border: 1px solid #00ff00;
      border-radius: 4px;
      color: #00ff00;
      font-size: 11px;
      white-space: nowrap;
      z-index: 10000;
      pointer-events: none;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    }

    .info-box-resize-handle {
      position: absolute;
      top: -10px; /* Half height above border (20px / 2 = 10px) */
      left: 50%;
      transform: translateX(-50%);
      width: 60px;
      height: 20px;
      cursor: ns-resize;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: rgba(17, 17, 17, 0.95);
      border: 1px solid #4caf50;
      border-radius: 4px;
      user-select: none;
      z-index: 10000;
    }

    .info-box-resize-handle:hover {
      background: rgba(17, 17, 17, 1);
      border-color: #66ff66;
    }

    .info-box-resize-handle::before {
      content: '⋮⋮';
      color: #4caf50;
      font-size: 12px;
      letter-spacing: 2px;
      opacity: 0.6;
    }

    .info-box-resize-handle:hover::before {
      opacity: 1;
      color: #66ff66;
    }

    .info-box-lock {
      width: 16px;
      height: 16px;
      cursor: pointer;
      opacity: 0.6;
      transition: opacity 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .info-box-lock:hover {
      opacity: 1;
    }

    .info-box-lock.locked::before {
      content: '🔒';
      font-size: 12px;
    }

    .info-box-lock.unlocked::before {
      content: '🔓';
      font-size: 12px;
    }

    .info-item-editable {
      position: relative;
    }

    .info-item-value-editable {
      color: #00ff00;
      font-size: 12px;
      word-wrap: break-word;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid transparent;
      border-radius: 3px;
      padding: 4px 6px;
      cursor: text;
      min-height: 18px;
    }

    .info-item-value-editable:hover {
      border-color: rgba(0, 255, 0, 0.5);
      background: rgba(0, 0, 0, 0.5);
    }

    .info-item-value-editable:focus {
      outline: none;
      border-color: #00ff00;
      background: rgba(0, 0, 0, 0.7);
    }

    .info-item-value-editable[contenteditable="true"] {
      border: 1px solid #00ff00;
    }

    .info-box-content {
      flex: 1;
      overflow-y: auto;
      min-height: 50px;
      max-height: 250px;
    }

    .info-box-content::-webkit-scrollbar {
      width: 8px;
    }

    .info-box-content::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.3);
      border-radius: 4px;
    }

    .info-box-content::-webkit-scrollbar-thumb {
      background: rgba(0, 255, 0, 0.3);
      border-radius: 4px;
    }

    .info-box-content::-webkit-scrollbar-thumb:hover {
      background: rgba(0, 255, 0, 0.5);
    }

    .info-box-empty {
      color: #aaffaa;
      font-style: italic;
      text-align: center;
      padding: 20px;
    }

    .info-item {
      margin-bottom: 10px;
      padding: 8px;
      background: rgba(0, 0, 0, 0.3);
      border-left: 2px solid #00ff00;
      border-radius: 4px;
    }

    .info-item-label {
      color: #aaffaa;
      font-size: 11px;
      margin-bottom: 4px;
    }

    .info-item-value {
      color: #00ff00;
      font-size: 12px;
      word-wrap: break-word;
    }

    .notification {
      margin-bottom: 8px;
      padding: 8px;
      background: rgba(0, 100, 0, 0.3);
      border-left: 3px solid #00ff00;
      border-radius: 4px;
      animation: slideIn 0.3s ease;
    }

    .notification.error {
      background: rgba(100, 0, 0, 0.3);
      border-left-color: #ff4444;
      color: #ff8888;
    }

    .notification.warning {
      background: rgba(100, 100, 0, 0.3);
      border-left-color: #ffaa00;
      color: #ffcc88;
    }

    .notification.info {
      background: rgba(0, 100, 100, 0.3);
      border-left-color: #00aaff;
      color: #88ccff;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateX(10px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    .notification-time {
      font-size: 10px;
      color: #888;
      margin-top: 4px;
    }
  `;
  document.head.appendChild(style);

  infoBox.innerHTML = `
    <div class="info-box-resize-handle" id="info-box-resize-handle">
      <div class="info-box-lock ${isResizeLocked ? 'locked' : 'unlocked'}" id="info-box-lock" title="${isResizeLocked ? 'Locked: Auto-resize disabled' : 'Unlocked: Auto-resize enabled'}"></div>
    </div>
    <div class="info-box-header">
      <div class="info-box-title" id="info-box-title">Info</div>
    </div>
    <div class="info-box-content" id="info-box-content">
      <div class="info-box-empty">No item selected</div>
    </div>
  `;

  // Set initial height if user has a preference
  if (userHeight !== null) {
    infoBox.style.height = `${userHeight}px`;
    infoBox.style.maxHeight = `${userHeight}px`;
  }

  // Set up resize handle (query within infoBox, not document)
  const resizeHandle = infoBox.querySelector('#info-box-resize-handle');
  const lockButton = infoBox.querySelector('#info-box-lock');

  if (!resizeHandle || !lockButton) {
    console.error('[InfoBox] Failed to find resize handle or lock button');
    document.body.appendChild(infoBox);
    return infoBox;
  }

  // Lock toggle
  lockButton.addEventListener('click', (e) => {
    e.stopPropagation();
    isResizeLocked = !isResizeLocked;
    lockButton.className = `info-box-lock ${isResizeLocked ? 'locked' : 'unlocked'}`;
    lockButton.title = isResizeLocked ? 'Locked: Auto-resize disabled' : 'Unlocked: Auto-resize enabled';
  });

  // Resize functionality
  resizeHandle.addEventListener('mousedown', (e) => {
    if (e.target === lockButton || lockButton.contains(e.target)) return; // Don't start resize if clicking lock
    
    isResizing = true;
    const startY = e.clientY;
    const startHeight = infoBox.offsetHeight;
    const minHeight = 100;
    const maxHeight = window.innerHeight - 100; // Don't go below toolbar

    const onMouseMove = (moveEvent) => {
      if (!isResizing) return;
      
      const deltaY = startY - moveEvent.clientY; // Inverted: drag up = increase height
      let newHeight = startHeight + deltaY;
      
      // Clamp to min/max
      newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
      
      infoBox.style.height = `${newHeight}px`;
      infoBox.style.maxHeight = `${newHeight}px`;
      userHeight = newHeight;
    };

    const onMouseUp = () => {
      isResizing = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
  });

  document.body.appendChild(infoBox);
  return infoBox;
}

/**
 * Update the info box with selected item information
 * @param {Object} itemInfo - Object containing item information
 * @param {Object} options - Optional configuration
 * @param {string} options.title - Custom title (default: "Info")
 * @param {string} options.tooltip - Tooltip text for title (shown on hover)
 * @param {Object} options.actions - Action callbacks { label: callback }
 * @param {Object} options.editableFields - Fields that should be editable { fieldName: { onSave: callback } }
 */
export function updateInfoBox(itemInfo, options = {}) {
  if (!infoBox) {
    createInfoBox();
  }
  // Make sure the box is visible
  infoBox.style.display = 'flex';

  const {
    title = 'Info',
    tooltip = '',
    actions = {},
    editableFields = {},
    source = 'unknown',
  } = options;
  const content = document.getElementById('info-box-content');
  const titleElement = document.getElementById('info-box-title');
  
  if (!content || !titleElement) return;

  const now = Date.now();

  // Update title (always update, even if itemInfo is empty)
  titleElement.textContent = title;
  if (tooltip) {
    titleElement.setAttribute('data-tooltip', tooltip);
  } else {
    titleElement.removeAttribute('data-tooltip');
  }

  if (!itemInfo || Object.keys(itemInfo).length === 0) {
    // If the last update was a structure very recently, avoid clearing immediately
    if (lastUpdateSource === 'structure' && now - lastUpdateTime < 1000) {
      return;
    }
    content.innerHTML = '<div class="info-box-empty">No item selected</div>';
    // Auto-resize if not locked
    if (!isResizeLocked && userHeight === null) {
      infoBox.style.height = 'auto';
      infoBox.style.maxHeight = '300px';
    }
    lastUpdateSource = source;
    lastUpdateTime = now;
    return;
  }

  let html = '';
  for (const [key, value] of Object.entries(itemInfo)) {
    const isEditable = editableFields.hasOwnProperty(key);
    const editableClass = isEditable ? 'info-item-editable' : '';
    const valueClass = isEditable ? 'info-item-value-editable' : 'info-item-value';
    const contentEditable = isEditable ? 'contenteditable="true"' : '';
    
    html += `
      <div class="info-item ${editableClass}">
        <div class="info-item-label">${key}:</div>
        <div class="${valueClass}" ${contentEditable} data-field="${key}">${value}</div>
      </div>
    `;
  }

  // Add action buttons if provided
  if (Object.keys(actions).length > 0) {
    html += '<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(0, 255, 0, 0.3);"></div>';
    for (const [label, callback] of Object.entries(actions)) {
      const actionId = `info-action-${label.toLowerCase().replace(/\s+/g, '-')}`;
      html += `
        <div class="info-item info-action" data-action-id="${actionId}" style="cursor: pointer; background: rgba(255, 0, 0, 0.2); border-left-color: #ff4444;">
          <div class="info-item-label">Action:</div>
          <div class="info-item-value">${label}</div>
        </div>
      `;
    }
  }

  content.innerHTML = html;

  lastUpdateSource = source;
  lastUpdateTime = now;

  // Auto-resize if not locked and no user preference
  if (!isResizeLocked && userHeight === null) {
    // Reset to auto height, then measure content
    infoBox.style.height = 'auto';
    infoBox.style.maxHeight = '300px';
    // Small delay to let content render, then adjust
    setTimeout(() => {
      if (!isResizeLocked && userHeight === null && infoBox) {
        const contentHeight = content.scrollHeight;
        const headerHeight = infoBox.querySelector('.info-box-header')?.offsetHeight || 0;
        const resizeHandleHeight = infoBox.querySelector('#info-box-resize-handle')?.offsetHeight || 0;
        const padding = 30; // Top and bottom padding
        const totalHeight = contentHeight + headerHeight + resizeHandleHeight + padding;
        const maxAllowed = Math.min(300, window.innerHeight - 100); // Cap to 300px unless the viewport is smaller
        const finalHeight = Math.min(Math.max(100, totalHeight), maxAllowed);
        infoBox.style.height = `${finalHeight}px`;
        infoBox.style.maxHeight = `${finalHeight}px`;
      }
    }, 10);
  }

  // Set up editable field handlers
  if (Object.keys(editableFields).length > 0) {
    content.querySelectorAll('.info-item-value-editable').forEach(element => {
      const fieldName = element.dataset.field;
      const fieldConfig = editableFields[fieldName];
      
      if (fieldConfig) {
        // Handle blur (save on lose focus)
        element.addEventListener('blur', () => {
          const newValue = element.textContent.trim();
          if (fieldConfig.onSave) {
            fieldConfig.onSave(newValue);
          }
        });
        
        // Handle Enter key (save and blur)
        element.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            element.blur();
          }
        });
      }
    });
  }

  // Set up action handlers using event delegation
  if (Object.keys(actions).length > 0) {
    content.addEventListener('click', (e) => {
      const actionItem = e.target.closest('.info-action');
      if (actionItem) {
        const actionId = actionItem.dataset.actionId;
        const actionLabel = actionItem.querySelector('.info-item-value')?.textContent;
        if (actionLabel && actions[actionLabel]) {
          actions[actionLabel]();
        }
      }
    });
  }
}

/**
 * Add a notification to the info box
 * @param {string} message - Notification message
 * @param {string} type - Notification type: 'info', 'warning', 'error'
 */
export function addNotification(message, type = 'info') {
  if (!infoBox) {
    createInfoBox();
  }

  const content = document.getElementById('info-box-content');
  if (!content) return;

  // Remove empty message if present
  const empty = content.querySelector('.info-box-empty');
  if (empty) {
    empty.remove();
  }

  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  const time = new Date().toLocaleTimeString();
  notification.innerHTML = `
    <div>${message}</div>
    <div class="notification-time">${time}</div>
  `;

  content.insertBefore(notification, content.firstChild);

  // Limit to 10 notifications
  const notifications = content.querySelectorAll('.notification');
  if (notifications.length > 10) {
    notifications[notifications.length - 1].remove();
  }

  // Auto-scroll to top to show newest notification
  content.scrollTop = 0;
}

/**
 * Clear all notifications
 */
export function clearNotifications() {
  if (!infoBox) return;

  const content = document.getElementById('info-box-content');
  if (!content) return;

  const notifications = content.querySelectorAll('.notification');
  notifications.forEach(n => n.remove());

  // Show empty message if no items
  if (content.children.length === 0) {
    content.innerHTML = '<div class="info-box-empty">No item selected</div>';
  }
}

