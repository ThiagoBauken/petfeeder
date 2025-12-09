// =============== AUTHENTICATION CHECK FOR MAIN APP ===============
function checkAuth() {
    const token = localStorage.getItem('petfeeder_token');
    const user = localStorage.getItem('petfeeder_user');

    if (!token || !user) {
        // Not logged in, redirect to auth page
        window.location.href = '/auth.html';
        return false;
    }

    // Display user info
    try {
        const userData = JSON.parse(user);
        displayUserInfo(userData);
    } catch (e) {
        console.error('Error parsing user data:', e);
    }

    return true;
}

function displayUserInfo(user) {
    // Add user menu to header if not exists
    if (!document.getElementById('user-menu')) {
        const headerStatus = document.querySelector('.header-status');
        const userMenu = document.createElement('div');
        userMenu.id = 'user-menu';
        userMenu.className = 'user-menu';

        const planLabel = getPlanLabel(user.plan);
        const dropdown = `
            <button class="user-menu-btn" onclick="toggleUserMenu()">
                <i class="fas fa-user-circle"></i>
                <span>${user.name}</span>
                <i class="fas fa-chevron-down"></i>
            </button>
            <div class="user-menu-dropdown hidden" id="user-menu-dropdown">
                <div class="user-menu-header">
                    <strong>${user.name}</strong>
                    <small>${user.email}</small>
                    <span class="user-plan">${planLabel}</span>
                </div>
                <hr>
                <a href="#" onclick="showProfile(); return false;">
                    <i class="fas fa-user"></i> Meu Perfil
                </a>
                <a href="#" onclick="showPlans(); return false;">
                    <i class="fas fa-crown"></i> Planos
                </a>
                <a href="#" onclick="showSettings(); return false;">
                    <i class="fas fa-cog"></i> Configurações
                </a>
                <hr>
                <a href="#" onclick="logout(); return false;" class="logout-btn">
                    <i class="fas fa-sign-out-alt"></i> Sair
                </a>
            </div>
        `;

        userMenu.innerHTML = dropdown;
        headerStatus.appendChild(userMenu);
    }
}

function getPlanLabel(plan) {
    const labels = {
        'free': 'Plano Gratuito',
        'basic': 'Plano Básico',
        'premium': 'Plano Premium',
        'enterprise': 'Plano Enterprise'
    };
    return labels[plan] || plan;
}

function toggleUserMenu() {
    const dropdown = document.getElementById('user-menu-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('hidden');
    }
}

// Close menu when clicking outside
document.addEventListener('click', function(e) {
    const userMenu = document.getElementById('user-menu');
    const dropdown = document.getElementById('user-menu-dropdown');

    if (userMenu && dropdown && !userMenu.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
});

function logout() {
    if (confirm('Tem certeza que deseja sair?')) {
        // Clear all data
        localStorage.removeItem('petfeeder_token');
        localStorage.removeItem('petfeeder_refresh_token');
        localStorage.removeItem('petfeeder_user');
        localStorage.removeItem('petfeeder_devices');
        localStorage.removeItem('petfeeder_history');

        showNotification('Logout', 'Saindo...', 'info');

        // Redirect to auth page
        setTimeout(() => {
            window.location.href = '/auth.html';
        }, 500);
    }
}

function showProfile() {
    showNotification('Perfil', 'Página de perfil em desenvolvimento', 'info');
}

function showPlans() {
    showNotification('Planos', 'Página de planos em desenvolvimento', 'info');
}

function showSettings() {
    // Navigate to settings tab
    const settingsBtn = document.querySelector('.tab-btn[data-tab="settings"]');
    if (settingsBtn) {
        settingsBtn.click();
    }
}

// Check auth on page load
(function() {
    if (window.location.pathname.includes('index.html') || window.location.pathname === '/') {
        // Only check auth on main app pages, not on auth.html
        if (!window.location.pathname.includes('auth.html')) {
            const hasAuth = checkAuth();
            if (!hasAuth) {
                return; // Stop execution if not authenticated
            }
        }
    }
})();
