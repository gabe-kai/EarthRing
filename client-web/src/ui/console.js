/**
 * Console Component
 * Hidden command console at top-left, toggled with ` key
 */

let consoleContainer = null;
let isVisible = false;
const commandHistory = [];
let historyIndex = -1;
let currentInput = '';

/**
 * Create the console component
 */
export function createConsole() {
  if (consoleContainer) {
    return consoleContainer;
  }

  consoleContainer = document.createElement('div');
  consoleContainer.id = 'console-container';
  consoleContainer.className = 'console-hidden';

  const style = document.createElement('style');
  style.textContent = `
    #console-container {
      position: fixed;
      top: 0;
      left: 0;
      background: rgba(0, 0, 0, 0.7);
      border: 2px solid #4caf50;
      border-top: none;
      border-left: none;
      border-bottom-right-radius: 8px;
      padding: 8px;
      font-family: 'Courier New', monospace;
      font-size: 10px;
      color: #00ff00;
      z-index: 10001;
      display: flex;
      flex-direction: column;
      max-height: calc(8 * 1.2em + 16px); /* 8 rows of text + padding */
      overflow-y: auto;
      backdrop-filter: blur(10px);
    }

    #console-container.console-hidden {
      display: none;
    }

    #console-container.console-visible {
      display: flex;
    }

    .console-output {
      flex: 1;
      overflow-y: auto;
      margin-bottom: 4px;
      min-height: calc(7 * 1.2em); /* 7 rows for output */
      max-height: calc(7 * 1.2em);
    }

    .console-line {
      line-height: 1.2em;
      margin: 0;
      padding: 0;
      word-wrap: break-word;
    }

    .console-input-line {
      display: flex;
      align-items: center;
      line-height: 1.2em;
      margin: 0;
      padding: 0;
    }

    .console-prompt {
      color: #00ff00;
      margin-right: 4px;
      user-select: none;
    }

    .console-input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: #00ff00;
      font-family: 'Courier New', monospace;
      font-size: 10px;
      padding: 0;
      margin: 0;
      width: 100%;
      caret-color: #00ff00;
    }

    .console-input::selection {
      background: rgba(0, 255, 0, 0.3);
    }

    .console-cursor {
      display: none; /* Hide the block cursor, use native caret instead */
    }

    @keyframes blink {
      0%, 50% { opacity: 1; }
      51%, 100% { opacity: 0; }
    }

    .console-output::-webkit-scrollbar {
      width: 4px;
    }

    .console-output::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.3);
    }

    .console-output::-webkit-scrollbar-thumb {
      background: rgba(0, 255, 0, 0.3);
      border-radius: 2px;
    }

    .console-output::-webkit-scrollbar-thumb:hover {
      background: rgba(0, 255, 0, 0.5);
    }
  `;
  document.head.appendChild(style);

  consoleContainer.innerHTML = `
    <div class="console-output" id="console-output"></div>
    <div class="console-input-line">
      <span class="console-prompt">></span>
      <input type="text" class="console-input" id="console-input" autocomplete="off" spellcheck="false" />
    </div>
  `;

  document.body.appendChild(consoleContainer);

  // Set up keyboard listener for toggle
  document.addEventListener('keydown', (e) => {
    if (e.key === '`' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      toggleConsole();
    }
  });

  // Set up input handler
  const input = consoleContainer.querySelector('#console-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCommand(input.value);
      input.value = '';
      currentInput = '';
      historyIndex = -1;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        if (historyIndex === -1) {
          currentInput = input.value;
        }
        historyIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
        input.value = commandHistory[commandHistory.length - 1 - historyIndex];
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        historyIndex--;
        input.value = commandHistory[commandHistory.length - 1 - historyIndex];
      } else if (historyIndex === 0) {
        historyIndex = -1;
        input.value = currentInput;
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideConsole();
    }
  });

  // Focus input when console is shown
  const observer = new MutationObserver(() => {
    if (isVisible && document.activeElement !== input) {
      input.focus();
    }
  });
  observer.observe(consoleContainer, { attributes: true, attributeFilter: ['class'] });

  return consoleContainer;
}

/**
 * Toggle console visibility
 */
export function toggleConsole() {
  if (!consoleContainer) {
    createConsole();
  }

  isVisible = !isVisible;
  if (isVisible) {
    showConsole();
  } else {
    hideConsole();
  }
}

/**
 * Show the console
 */
export function showConsole() {
  if (!consoleContainer) {
    createConsole();
  }

  isVisible = true;
  consoleContainer.classList.remove('console-hidden');
  consoleContainer.classList.add('console-visible');
  
  // Update width based on auth box position
  updateConsoleWidth();
  
  // Focus input
  const input = consoleContainer.querySelector('#console-input');
  if (input) {
    setTimeout(() => input.focus(), 10);
  }
}

/**
 * Hide the console
 */
export function hideConsole() {
  if (consoleContainer) {
    isVisible = false;
    consoleContainer.classList.remove('console-visible');
    consoleContainer.classList.add('console-hidden');
  }
}

/**
 * Update console width to fit between left edge and auth box
 */
function updateConsoleWidth() {
  if (!consoleContainer) return;

  const authBox = document.querySelector('.auth-modal');
  if (authBox) {
    const authBoxLeft = authBox.offsetLeft;
    const margin = 10; // Small margin between console and auth box
    const consoleWidth = authBoxLeft - margin;
    consoleContainer.style.width = `${Math.max(200, consoleWidth)}px`;
  } else {
    // Default width if auth box not visible
    consoleContainer.style.width = '400px';
  }
}

/**
 * Handle console command
 */
function handleCommand(command) {
  if (!command.trim()) return;

  // Add to history
  commandHistory.push(command);
  if (commandHistory.length > 50) {
    commandHistory.shift(); // Keep last 50 commands
  }

  // Add command to output
  addOutput(`> ${command}`);

  // Process command
  try {
    const result = processCommand(command);
    if (result !== null) {
      addOutput(result);
    }
  } catch (error) {
    addOutput(`Error: ${error.message}`);
  }

  // Scroll to bottom
  const output = consoleContainer.querySelector('#console-output');
  if (output) {
    output.scrollTop = output.scrollHeight;
  }
}

/**
 * Process a console command
 */
function processCommand(command) {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  const debugPanel = window.earthring?.debugPanel || window.earthring?.debugInfoPanel;

  switch (cmd) {
    case 'help':
    case '?':
      return `Available commands:
  help, ? - Show this help message
  clear - Clear console output
  echo <text> - Echo text back
  version - Show version info
  perf, performance - Show performance debug info (FPS, frame time, draw calls, etc.)
  camera - Show camera debug info (position, target)
  cursor - Show cursor debug info (raw, converted, screen coordinates)
  render, rendering - Show rendering debug info (scene objects, chunks, zones, renderer size)
  debug - Show/hide the debug info panel (top-right)`;

    case 'clear':
      const output = consoleContainer.querySelector('#console-output');
      if (output) {
        output.innerHTML = '';
      }
      return null;

    case 'echo':
      return args.join(' ');

    case 'version':
      return 'EarthRing Console v1.0.0';

    case 'perf':
    case 'performance':
      if (!debugPanel) {
        return 'Debug panel not available';
      }
      return debugPanel.getPerformanceData();

    case 'camera':
      if (!debugPanel) {
        return 'Debug panel not available';
      }
      return debugPanel.getCameraData();

    case 'cursor':
      if (!debugPanel) {
        return 'Debug panel not available';
      }
      return debugPanel.getCursorData();

    case 'render':
    case 'rendering':
      if (!debugPanel) {
        return 'Debug panel not available';
      }
      return debugPanel.getRenderingData();

    case 'debug':
      if (!debugPanel) {
        return 'Debug panel not available';
      }
      debugPanel.showPanel();
      return 'Debug panel shown';

    default:
      return `Unknown command: ${cmd}. Type 'help' for available commands.`;
  }
}

/**
 * Add output line to console
 */
function addOutput(text) {
  const output = consoleContainer.querySelector('#console-output');
  if (!output) return;

  const line = document.createElement('div');
  line.className = 'console-line';
  line.textContent = text;
  output.appendChild(line);

  // Keep only last 100 lines
  while (output.children.length > 100) {
    output.removeChild(output.firstChild);
  }
}

// Update console width when window resizes
window.addEventListener('resize', () => {
  if (isVisible) {
    updateConsoleWidth();
  }
});

// Watch for auth box changes
const authObserver = new MutationObserver(() => {
  if (isVisible) {
    updateConsoleWidth();
  }
});
if (document.body) {
  authObserver.observe(document.body, { childList: true, subtree: true });
}

