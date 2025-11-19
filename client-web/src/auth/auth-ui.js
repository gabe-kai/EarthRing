/**
 * Authentication UI Component
 * Simple overlay UI for login and registration
 */

import { register, login, storeTokens, logout, getCurrentUser } from './auth-service.js';

let authContainer = null;
let currentView = 'login'; // 'login' or 'register'

/**
 * Create and show the authentication UI overlay
 */
export function showAuthUI() {
  if (authContainer) {
    return; // Already shown
  }

  authContainer = document.createElement('div');
  authContainer.id = 'auth-overlay';
  authContainer.innerHTML = `
    <div class="auth-modal">
      <div class="auth-header">
        <h1>EarthRing</h1>
        <p class="auth-subtitle">Authentication Required</p>
      </div>
      
      <div id="auth-forms">
        <!-- Login form will be inserted here -->
      </div>
      
      <div class="auth-footer">
        <button id="auth-toggle" class="auth-link">Need an account? Register</button>
      </div>
    </div>
  `;

  // Add styles
  const style = document.createElement('style');
  style.textContent = `
    #auth-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.85);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    }
    
    .auth-modal {
      background: #1a1a1a;
      border-radius: 12px;
      padding: 2rem;
      width: 90%;
      max-width: 400px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      border: 1px solid #333;
    }
    
    .auth-header {
      text-align: center;
      margin-bottom: 2rem;
    }
    
    .auth-header h1 {
      color: #00ff00;
      font-size: 2rem;
      margin-bottom: 0.5rem;
      font-weight: 600;
    }
    
    .auth-subtitle {
      color: #aaa;
      font-size: 0.9rem;
    }
    
    .auth-form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    
    .auth-form-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .auth-form-group label {
      color: #ccc;
      font-size: 0.9rem;
      font-weight: 500;
    }
    
    .auth-form-group input {
      padding: 0.75rem;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 6px;
      color: #fff;
      font-size: 1rem;
      transition: border-color 0.2s;
    }
    
    .auth-form-group input:focus {
      outline: none;
      border-color: #00ff00;
    }
    
    .auth-form-group input::placeholder {
      color: #666;
    }
    
    .auth-error {
      background: #4a1a1a;
      border: 1px solid #ff4444;
      color: #ff8888;
      padding: 0.75rem;
      border-radius: 6px;
      font-size: 0.9rem;
      display: none;
    }
    
    .auth-error.show {
      display: block;
    }
    
    .auth-success {
      background: #1a4a1a;
      border: 1px solid #44ff44;
      color: #88ff88;
      padding: 0.75rem;
      border-radius: 6px;
      font-size: 0.9rem;
      display: none;
    }
    
    .auth-success.show {
      display: block;
    }
    
    .auth-button {
      padding: 0.75rem;
      background: #00ff00;
      color: #000;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      margin-top: 0.5rem;
    }
    
    .auth-button:hover {
      background: #00cc00;
    }
    
    .auth-button:disabled {
      background: #444;
      color: #888;
      cursor: not-allowed;
    }
    
    .auth-footer {
      margin-top: 1.5rem;
      text-align: center;
    }
    
    .auth-link {
      background: none;
      border: none;
      color: #00ff00;
      cursor: pointer;
      text-decoration: underline;
      font-size: 0.9rem;
      padding: 0;
    }
    
    .auth-link:hover {
      color: #00cc00;
    }
    
    .auth-loading {
      text-align: center;
      color: #aaa;
      font-size: 0.9rem;
      margin-top: 1rem;
    }
  `;
  
  document.head.appendChild(style);
  document.body.appendChild(authContainer);

  // Set up event listeners
  setupAuthListeners();
  
  // Show initial form (login)
  showLoginForm();
}

/**
 * Hide the authentication UI
 */
export function hideAuthUI() {
  if (authContainer) {
    authContainer.remove();
    authContainer = null;
  }
}

/**
 * Show login form
 */
function showLoginForm() {
  currentView = 'login';
  const formsContainer = document.getElementById('auth-forms');
  const toggleButton = document.getElementById('auth-toggle');
  
  formsContainer.innerHTML = `
    <form id="login-form" class="auth-form">
      <div class="auth-error" id="login-error"></div>
      <div class="auth-success" id="login-success"></div>
      
      <div class="auth-form-group">
        <label for="login-username">Username</label>
        <input 
          type="text" 
          id="login-username" 
          placeholder="Enter your username" 
          required 
          autocomplete="username"
        />
      </div>
      
      <div class="auth-form-group">
        <label for="login-password">Password</label>
        <input 
          type="password" 
          id="login-password" 
          placeholder="Enter your password" 
          required 
          autocomplete="current-password"
        />
      </div>
      
      <button type="submit" class="auth-button" id="login-button">Login</button>
      <div class="auth-loading" id="login-loading" style="display: none;">Logging in...</div>
    </form>
  `;
  
  toggleButton.textContent = 'Need an account? Register';
  
  // Set up form handler
  const form = document.getElementById('login-form');
  form.addEventListener('submit', handleLogin);
}

/**
 * Show registration form
 */
function showRegisterForm() {
  currentView = 'register';
  const formsContainer = document.getElementById('auth-forms');
  const toggleButton = document.getElementById('auth-toggle');
  
  formsContainer.innerHTML = `
    <form id="register-form" class="auth-form">
      <div class="auth-error" id="register-error"></div>
      <div class="auth-success" id="register-success"></div>
      
      <div class="auth-form-group">
        <label for="register-username">Username</label>
        <input 
          type="text" 
          id="register-username" 
          placeholder="3-32 characters (letters, numbers, _, -)" 
          required 
          autocomplete="username"
          minlength="3"
          maxlength="32"
        />
      </div>
      
      <div class="auth-form-group">
        <label for="register-email">Email</label>
        <input 
          type="email" 
          id="register-email" 
          placeholder="your.email@example.com" 
          required 
          autocomplete="email"
        />
      </div>
      
      <div class="auth-form-group">
        <label for="register-password">Password</label>
        <input 
          type="password" 
          id="register-password" 
          placeholder="8+ chars, uppercase, lowercase, number, special" 
          required 
          autocomplete="new-password"
        />
        <small style="color: #666; font-size: 0.8rem; margin-top: 0.25rem;">
          Must be at least 8 characters with uppercase, lowercase, number, and special character
        </small>
      </div>
      
      <button type="submit" class="auth-button" id="register-button">Register</button>
      <div class="auth-loading" id="register-loading" style="display: none;">Creating account...</div>
    </form>
  `;
  
  toggleButton.textContent = 'Already have an account? Login';
  
  // Set up form handler
  const form = document.getElementById('register-form');
  form.addEventListener('submit', handleRegister);
}

/**
 * Set up event listeners
 */
function setupAuthListeners() {
  const toggleButton = document.getElementById('auth-toggle');
  toggleButton.addEventListener('click', () => {
    if (currentView === 'login') {
      showRegisterForm();
    } else {
      showLoginForm();
    }
  });
}

/**
 * Handle login form submission
 */
async function handleLogin(e) {
  e.preventDefault();
  
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errorDiv = document.getElementById('login-error');
  const successDiv = document.getElementById('login-success');
  const button = document.getElementById('login-button');
  const loading = document.getElementById('login-loading');
  
  // Clear previous messages
  errorDiv.classList.remove('show');
  successDiv.classList.remove('show');
  button.disabled = true;
  loading.style.display = 'block';
  
  try {
    const response = await login(username, password);
    storeTokens(response);
    
    successDiv.textContent = `Welcome back, ${response.username}!`;
    successDiv.classList.add('show');
    
    // Hide UI after a short delay
    setTimeout(() => {
      hideAuthUI();
      // Trigger custom event for other parts of the app
      window.dispatchEvent(new CustomEvent('auth:login', { detail: response }));
    }, 1000);
  } catch (error) {
    errorDiv.textContent = error.message || 'Login failed. Please try again.';
    errorDiv.classList.add('show');
    button.disabled = false;
    loading.style.display = 'none';
  }
}

/**
 * Handle registration form submission
 */
async function handleRegister(e) {
  e.preventDefault();
  
  const username = document.getElementById('register-username').value;
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  const errorDiv = document.getElementById('register-error');
  const successDiv = document.getElementById('register-success');
  const button = document.getElementById('register-button');
  const loading = document.getElementById('register-loading');
  
  // Clear previous messages
  errorDiv.classList.remove('show');
  successDiv.classList.remove('show');
  button.disabled = true;
  loading.style.display = 'block';
  
  try {
    const response = await register(username, email, password);
    storeTokens(response);
    
    successDiv.textContent = `Account created! Welcome, ${response.username}!`;
    successDiv.classList.add('show');
    
    // Hide UI after a short delay
    setTimeout(() => {
      hideAuthUI();
      // Trigger custom event for other parts of the app
      window.dispatchEvent(new CustomEvent('auth:register', { detail: response }));
    }, 1500);
  } catch (error) {
    errorDiv.textContent = error.message || 'Registration failed. Please try again.';
    errorDiv.classList.add('show');
    button.disabled = false;
    loading.style.display = 'none';
  }
}

/**
 * Show user info and logout button (when authenticated)
 */
export function showUserInfo() {
  const user = getCurrentUser();
  if (!user) {
    return;
  }
  
  // Remove existing user bar if present
  const existingBar = document.getElementById('user-info-bar');
  if (existingBar) {
    existingBar.remove();
  }
  
  // Create user info bar
  const userBar = document.createElement('div');
  userBar.id = 'user-info-bar';
  userBar.innerHTML = `
    <div style="position: fixed; top: 10px; right: 10px; background: rgba(0, 0, 0, 0.8); padding: 0.75rem 1rem; border-radius: 6px; border: 1px solid #333; z-index: 9999; display: flex; align-items: center; gap: 1rem; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; flex-wrap: wrap;">
      <span style="color: #00ff00; font-weight: 500;">Logged in as: ${user.username}</span>
      <button id="player-panel-btn" style="background: #00ff00; color: #000; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">Player</button>
      <button id="chunk-panel-btn" style="background: #00ff00; color: #000; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">Chunks</button>
      <button id="zone-panel-btn" style="background: #00ff00; color: #000; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">Zones</button>
      <button id="logout-button" style="background: #ff4444; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.9rem;">Logout</button>
    </div>
  `;
  
  document.body.appendChild(userBar);
  
  // Set up logout handler
  document.getElementById('logout-button').addEventListener('click', async () => {
    await logout();
    userBar.remove();
    showAuthUI();
    window.dispatchEvent(new CustomEvent('auth:logout'));
  });
  
  // Set up panel buttons (will be imported in main.js)
  const playerBtn = document.getElementById('player-panel-btn');
  const chunkBtn = document.getElementById('chunk-panel-btn');
  const zoneBtn = document.getElementById('zone-panel-btn');
  
  if (playerBtn) {
    playerBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('show:player-panel'));
    });
  }
  
  if (chunkBtn) {
    chunkBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('show:chunk-panel'));
    });
  }
  
  if (zoneBtn) {
    zoneBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('show:zone-panel'));
    });
  }
}

