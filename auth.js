// =============== AUTH CONFIGURATION ===============
const API_URL = 'http://localhost:3000/api';

// =============== DOM ELEMENTS ===============
const loginForm = document.getElementById('form-login');
const registerForm = document.getElementById('form-register');
const loadingOverlay = document.getElementById('loading-overlay');

// =============== INITIALIZE ===============
document.addEventListener('DOMContentLoaded', function() {
    // Check if already logged in
    const token = localStorage.getItem('petfeeder_token');
    if (token) {
        // Verify token and redirect
        verifyToken(token);
    }

    // Setup form handlers
    setupFormHandlers();

    // Password strength checker
    const passwordInput = document.getElementById('register-password');
    if (passwordInput) {
        passwordInput.addEventListener('input', checkPasswordStrength);
    }
});

// =============== FORM HANDLERS ===============
function setupFormHandlers() {
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }
}

// =============== LOGIN ===============
async function handleLogin(e) {
    e.preventDefault();

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const rememberMe = document.getElementById('remember-me').checked;

    showLoading();

    try {
        const response = await fetch(API_URL + '/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Store tokens
            localStorage.setItem('petfeeder_token', data.data.accessToken);
            if (rememberMe) {
                localStorage.setItem('petfeeder_refresh_token', data.data.refreshToken);
            }

            // Store user data
            localStorage.setItem('petfeeder_user', JSON.stringify(data.data.user));

            showNotification('Sucesso!', 'Login realizado com sucesso', 'success');

            // Redirect to dashboard
            setTimeout(() => {
                window.location.href = '/index.html';
            }, 1000);
        } else {
            showNotification('Erro', data.message || 'Erro ao fazer login', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showNotification('Erro', 'Erro de conexão com o servidor', 'error');
    } finally {
        hideLoading();
    }
}

// =============== REGISTER ===============
async function handleRegister(e) {
    e.preventDefault();

    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm-password').value;
    const acceptTerms = document.getElementById('accept-terms').checked;

    // Validations
    if (password !== confirmPassword) {
        showNotification('Erro', 'As senhas não coincidem', 'error');
        return;
    }

    if (!acceptTerms) {
        showNotification('Erro', 'Você deve aceitar os termos de uso', 'error');
        return;
    }

    if (password.length < 8) {
        showNotification('Erro', 'A senha deve ter no mínimo 8 caracteres', 'error');
        return;
    }

    showLoading();

    try {
        const response = await fetch(API_URL + '/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name,
                email,
                password,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Store tokens
            localStorage.setItem('petfeeder_token', data.data.accessToken);
            localStorage.setItem('petfeeder_refresh_token', data.data.refreshToken);

            // Store user data
            localStorage.setItem('petfeeder_user', JSON.stringify(data.data.user));

            showNotification('Sucesso!', 'Conta criada com sucesso!', 'success');

            // Redirect to dashboard
            setTimeout(() => {
                window.location.href = '/index.html';
            }, 1000);
        } else {
            showNotification('Erro', data.message || 'Erro ao criar conta', 'error');
        }
    } catch (error) {
        console.error('Register error:', error);
        showNotification('Erro', 'Erro de conexão com o servidor', 'error');
    } finally {
        hideLoading();
    }
}

// =============== TOKEN VERIFICATION ===============
async function verifyToken(token) {
    try {
        const response = await fetch(API_URL + '/auth/verify', {
            headers: {
                'Authorization': 'Bearer ' + token
            }
        });

        if (response.ok) {
            // Token is valid, redirect to dashboard
            window.location.href = '/index.html';
        } else {
            // Token invalid, clear storage
            localStorage.removeItem('petfeeder_token');
            localStorage.removeItem('petfeeder_refresh_token');
            localStorage.removeItem('petfeeder_user');
        }
    } catch (error) {
        console.error('Token verification error:', error);
    }
}

// =============== UI HELPERS ===============
function showLogin() {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
}

function showRegister() {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
}

function togglePassword(inputId) {
    const input = document.getElementById(inputId);
    const icon = input.parentElement.querySelector('.toggle-password i');

    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

function checkPasswordStrength(e) {
    const password = e.target.value;
    const strengthBar = document.getElementById('password-strength');

    if (!strengthBar) return;

    let strength = 0;

    // Length
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;

    // Character variety
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
    if (/\d/.test(password)) strength++;
    if (/[^a-zA-Z\d]/.test(password)) strength++;

    // Update UI
    strengthBar.className = 'password-strength';
    if (strength <= 2) {
        strengthBar.classList.add('weak');
    } else if (strength <= 4) {
        strengthBar.classList.add('medium');
    } else {
        strengthBar.classList.add('strong');
    }
}

function showLoading() {
    loadingOverlay.classList.add('show');
}

function hideLoading() {
    loadingOverlay.classList.remove('show');
}

function showNotification(title, message, type) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'notification notification-' + type;
    notification.innerHTML = '<div class="notification-content"><strong>' + title + '</strong><p>' + message + '</p></div>';

    // Add styles
    const bgColor = type === 'success' ? '#48bb78' : type === 'error' ? '#f56565' : '#4299e1';
    notification.style.cssText = 'position: fixed; top: 20px; right: 20px; background: ' + bgColor + '; color: white; padding: 1rem 1.5rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 10001; animation: slideIn 0.3s ease;';

    document.body.appendChild(notification);

    // Remove after 4 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (document.body.contains(notification)) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, 4000);
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = '@keyframes slideIn { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } } @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(400px); opacity: 0; } }';
document.head.appendChild(style);
