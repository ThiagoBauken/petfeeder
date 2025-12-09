// ===================================
// PETFEEDER APPLICATION LOGIC
// ===================================

// Global state
let state = {
    user: null,
    devices: [],
    pets: [],
    schedules: [],
    history: [],
    currentDevice: null,
    deviceStatus: {}, // { deviceId: { food_level, distance_cm, lastSeen } }
};

// ===================================
// INITIALIZATION
// ===================================

// Check authentication on load
window.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem(CONFIG.STORAGE_KEYS.ACCESS_TOKEN);

    if (!token) {
        // Not logged in, redirect to login
        window.location.href = 'login.html';
        return;
    }

    // Initialize app
    await initializeApp();
});

async function initializeApp() {
    try {
        // Load user data
        await loadUserData();

        // Connect WebSocket
        connectWebSocket();

        // Load initial data
        await loadAllData();

        // Setup clock
        updateClock();
        setInterval(updateClock, 1000);

        // Update connection status
        updateConnectionStatus();

    } catch (error) {
        console.error('Initialization error:', error);
        showToast('Erro ao inicializar aplicação', 'error');

        // If auth error, logout
        if (error.message.includes('401') || error.message.includes('token')) {
            logout();
        }
    }
}

// ===================================
// USER & AUTH
// ===================================

async function loadUserData() {
    try {
        const result = await api.getMe();
        if (result.success) {
            state.user = result.data;
            document.getElementById('userName').textContent = state.user.name || state.user.email;
            localStorage.setItem(CONFIG.STORAGE_KEYS.USER_DATA, JSON.stringify(state.user));
        }
    } catch (error) {
        console.error('Error loading user:', error);
        throw error;
    }
}

function logout() {
    // Disconnect WebSocket
    if (ws) {
        ws.disconnect();
    }

    // Call logout API
    api.logoutAPI().catch(console.error);

    // Redirect to login
    window.location.href = 'login.html';
}

// ===================================
// DATA LOADING
// ===================================

async function loadAllData() {
    await Promise.all([
        loadDevices(),
        loadPets(),
        loadSchedules(),
        loadHistory(),
    ]);
    // Mostra email do usuário após carregar dados
    loadUserEmail();
}

async function loadDevices() {
    try {
        const result = await api.getDevices();
        if (result.success) {
            state.devices = result.data;
            renderDevicesList();
            updateDeviceSelects();
            renderFoodLevels();
        }
    } catch (error) {
        console.error('Error loading devices:', error);
        showToast('Erro ao carregar dispositivos', 'error');
    }
}

async function loadPets() {
    try {
        const result = await api.getPets();
        if (result.success) {
            state.pets = result.data;
            renderPetCards();
            renderPetsList();
            updatePetSelects();
        }
    } catch (error) {
        console.error('Error loading pets:', error);
        showToast('Erro ao carregar pets', 'error');
    }
}

async function loadSchedules() {
    try {
        const result = await api.getSchedules();
        if (result.success) {
            state.schedules = result.data;
            renderSchedulesList();
        }
    } catch (error) {
        console.error('Error loading schedules:', error);
        showToast('Erro ao carregar horários', 'error');
    }
}

async function loadHistory() {
    try {
        const deviceId = document.getElementById('historyDeviceFilter')?.value || null;
        const petId = document.getElementById('historyPetFilter')?.value || null;
        const days = document.getElementById('historyDaysFilter')?.value || 7;

        const params = {};
        if (deviceId) params.device_id = deviceId;
        if (petId) params.pet_id = petId;
        params.days = days;

        const result = await api.getHistory(params);
        if (result.success) {
            state.history = result.data;
            renderHistoryList();
        }
    } catch (error) {
        console.error('Error loading history:', error);
        showToast('Erro ao carregar histórico', 'error');
    }
}

async function refreshData() {
    showToast('Atualizando dados...', 'info');
    await loadAllData();
    showToast('Dados atualizados!', 'success');
}

// ===================================
// WEBSOCKET
// ===================================

function connectWebSocket() {
    // Connect
    ws.connect();

    // Setup event handlers
    ws.on('authenticated', () => {
        console.log('WebSocket authenticated');
        updateConnectionStatus();

        // Subscribe to device topics
        if (state.devices.length > 0) {
            const topics = state.devices.map(d => `device:${d.device_id}`);
            ws.subscribe(topics);
        }
    });

    ws.on('device_status', (data) => {
        console.log('Device status update:', data);
        // Handle both formats: data.deviceId/data.status and data.data
        const statusData = data.data || data;
        const deviceId = statusData.device_id || data.deviceId;
        updateDeviceStatus(deviceId, statusData);
    });

    ws.on('feeding', (data) => {
        console.log('Feeding event:', data);
        showToast(`Alimentação: ${data.data.pet_name} - ${data.data.amount}g`, 'success');
        loadHistory();
    });

    ws.on('alert', (data) => {
        console.log('Alert:', data);
        showToast(data.data.message, 'warning');
    });

    ws.on('disconnected', () => {
        updateConnectionStatus();
    });
}

function updateDeviceStatus(deviceId, status) {
    const device = state.devices.find(d => d.device_id === deviceId);
    if (device) {
        device.online = status.online !== false;
        device.last_seen = status.timestamp || new Date().toISOString();
        renderDevicesList();
    }

    // Update food level status
    if (status.food_level !== undefined) {
        state.deviceStatus[deviceId] = {
            food_level: status.food_level,
            distance_cm: status.distance_cm,
            lastSeen: new Date().toISOString()
        };
        renderFoodLevels();
        checkLowFoodAlert();
    }
}

// ===================================
// RENDERING
// ===================================

// Render food levels for all devices
function renderFoodLevels() {
    const container = document.getElementById('foodLevelContainer');
    if (!container) return;

    if (!state.devices || state.devices.length === 0) {
        container.innerHTML = `
            <div class="no-devices-msg">
                <i class="fas fa-microchip"></i>
                <p>Nenhum dispositivo vinculado.</p>
                <p><small>Configure seu ESP32 na aba Dispositivos.</small></p>
            </div>
        `;
        return;
    }

    container.innerHTML = state.devices.map(device => {
        const status = state.deviceStatus[device.device_id] || {};
        const level = status.food_level !== undefined ? status.food_level : null;
        const levelClass = level === null ? '' : level > 50 ? 'level-high' : level > 20 ? 'level-medium' : 'level-low';
        const levelText = level !== null ? `${level}%` : 'Aguardando...';
        const lastSeen = status.lastSeen ? formatTimeAgo(status.lastSeen) : 'Nunca';

        return `
            <div class="food-level-item">
                <div class="food-level-header">
                    <div class="device-name">
                        <i class="fas fa-microchip" style="color: ${device.status === 'online' ? '#28a745' : '#dc3545'}"></i>
                        ${device.name || device.device_id}
                    </div>
                    <div class="level-value" style="color: ${level === null ? '#999' : level > 50 ? '#28a745' : level > 20 ? '#fd7e14' : '#dc3545'}">
                        ${levelText}
                    </div>
                </div>
                <div class="food-level-bar">
                    <div class="food-level-fill ${levelClass}" style="width: ${level !== null ? level : 0}%">
                        ${level !== null && level > 15 ? `<span class="food-level-text">${level}%</span>` : ''}
                    </div>
                </div>
                <div class="food-level-info">
                    <span><i class="fas fa-clock"></i> Atualizado: ${lastSeen}</span>
                    <span><i class="fas fa-wifi"></i> ${device.status === 'online' ? 'Online' : 'Offline'}</span>
                </div>
            </div>
        `;
    }).join('');
}

// Refresh food levels by requesting from server
async function refreshFoodLevels() {
    showToast('Verificando nível de ração...', 'info');

    // For each device, request the status from server
    for (const device of state.devices) {
        try {
            // The ESP32 sends status every 5 min, but we can fetch the cached status from server
            const result = await api.request('GET', `/devices/${device.device_id}/status`);
            if (result.success && result.data) {
                state.deviceStatus[device.device_id] = {
                    food_level: result.data.food_level,
                    distance_cm: result.data.distance_cm,
                    lastSeen: result.data.lastSeen || new Date().toISOString()
                };
            }
        } catch (error) {
            console.log('Status not available for', device.device_id);
        }
    }

    renderFoodLevels();
    checkLowFoodAlert();
    showToast('Níveis atualizados!', 'success');
}

// Check for low food alert
function checkLowFoodAlert() {
    const alertEl = document.getElementById('lowFoodAlert');
    const msgEl = document.getElementById('lowFoodMessage');
    if (!alertEl || !msgEl) return;

    const lowDevices = [];
    for (const device of state.devices) {
        const status = state.deviceStatus[device.device_id];
        if (status && status.food_level !== undefined && status.food_level < 20) {
            lowDevices.push(device.name || device.device_id);
        }
    }

    if (lowDevices.length > 0) {
        msgEl.textContent = `Nível de ração baixo em: ${lowDevices.join(', ')}! Reponha a ração.`;
        alertEl.style.display = 'flex';
    } else {
        alertEl.style.display = 'none';
    }
}

// Format time ago
function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return 'Agora mesmo';
    if (diff < 3600) return `${Math.floor(diff / 60)} min atrás`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
    return date.toLocaleDateString('pt-BR');
}

function renderPetCards() {
    const container = document.getElementById('petCards');

    if (!state.pets || state.pets.length === 0) {
        container.innerHTML = `
            <div class="card">
                <p style="text-align: center; color: #666;">
                    <i class="fas fa-info-circle"></i>
                    Nenhum pet cadastrado.
                    <a href="#" onclick="switchTab('pets'); return false;">Adicione seu primeiro pet!</a>
                </p>
            </div>
        `;
        return;
    }

    container.innerHTML = state.pets.map(pet => `
        <div class="pet-card">
            <div class="pet-card-header">
                <div class="pet-avatar">${getpetEmoji(pet.type)}</div>
                <div>
                    <h3>${pet.name}</h3>
                    <p class="pet-type">${getPetTypeLabel(pet.type)}</p>
                </div>
            </div>
            <div class="pet-card-body">
                <div class="pet-stat">
                    <span class="pet-stat-label">Dispositivo:</span>
                    <span class="pet-stat-value">${pet.device_name || 'N/A'}</span>
                </div>
                <div class="pet-stat">
                    <span class="pet-stat-label">Compartimento:</span>
                    <span class="pet-stat-value">${pet.compartment}</span>
                </div>
                <div class="pet-stat">
                    <span class="pet-stat-label">Diário:</span>
                    <span class="pet-stat-value">${pet.daily_amount || 0}g</span>
                </div>
            </div>
            <div class="pet-card-footer">
                <button class="btn btn-sm btn-primary" onclick="feedPet(${pet.id}, ${pet.device_id})">
                    <i class="fas fa-utensils"></i> Alimentar
                </button>
            </div>
        </div>
    `).join('');
}

function renderPetsList() {
    const container = document.getElementById('petsList');

    if (!state.pets || state.pets.length === 0) {
        container.innerHTML = `
            <div class="card">
                <p style="text-align: center; color: #666;">Nenhum pet cadastrado.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = state.pets.map(pet => `
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; gap: 15px; align-items: center;">
                    <div class="pet-avatar" style="font-size: 32px;">${getPetEmoji(pet.type)}</div>
                    <div>
                        <h3 style="margin: 0;">${pet.name}</h3>
                        <p style="margin: 5px 0; color: #666;">
                            ${getPetTypeLabel(pet.type)} • ${pet.device_name} • Compartimento ${pet.compartment}
                        </p>
                        <p style="margin: 5px 0; color: #666;">
                            Quantidade diária: ${pet.daily_amount || 0}g
                        </p>
                    </div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-sm btn-secondary" onclick="editPet(${pet.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deletePet(${pet.id}, '${pet.name}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

function renderSchedulesList() {
    const container = document.getElementById('schedulesList');

    if (!state.schedules || state.schedules.length === 0) {
        container.innerHTML = `
            <div class="card">
                <p style="text-align: center; color: #666;">Nenhum horário programado.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = state.schedules.map(schedule => {
        const weekdays = [];
        if (schedule.monday) weekdays.push('Seg');
        if (schedule.tuesday) weekdays.push('Ter');
        if (schedule.wednesday) weekdays.push('Qua');
        if (schedule.thursday) weekdays.push('Qui');
        if (schedule.friday) weekdays.push('Sex');
        if (schedule.saturday) weekdays.push('Sáb');
        if (schedule.sunday) weekdays.push('Dom');

        return `
            <div class="card">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3 style="margin: 0;">
                            ${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}
                            <span class="badge badge-${schedule.active ? 'success' : 'secondary'}">
                                ${schedule.active ? 'Ativo' : 'Inativo'}
                            </span>
                        </h3>
                        <p style="margin: 5px 0; color: #666;">
                            ${schedule.pet_name} • ${schedule.amount}g • ${weekdays.join(', ')}
                        </p>
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button class="btn btn-sm btn-secondary" onclick="toggleSchedule(${schedule.id}, ${!schedule.active})">
                            <i class="fas fa-${schedule.active ? 'pause' : 'play'}"></i>
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="deleteSchedule(${schedule.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderHistoryList() {
    const container = document.getElementById('historyList');

    if (!state.history || state.history.length === 0) {
        container.innerHTML = `
            <div class="card">
                <p style="text-align: center; color: #666;">Nenhum registro encontrado.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = state.history.map(item => {
        const date = new Date(item.timestamp);
        const statusIcon = item.status === 'success' ? 'check-circle' : 'exclamation-circle';
        const statusColor = item.status === 'success' ? '#48bb78' : '#f56565';

        return `
            <div class="card">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h4 style="margin: 0;">
                            <i class="fas fa-${statusIcon}" style="color: ${statusColor};"></i>
                            ${item.pet_name || 'Pet não identificado'}
                        </h4>
                        <p style="margin: 5px 0; color: #666;">
                            ${date.toLocaleDateString('pt-BR')} às ${date.toLocaleTimeString('pt-BR')}
                        </p>
                        <p style="margin: 5px 0; color: #666;">
                            ${item.amount}g • ${getTriggerLabel(item.trigger)}
                        </p>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderDevicesList() {
    const container = document.getElementById('devicesList');

    if (!state.devices || state.devices.length === 0) {
        container.innerHTML = `
            <div class="card">
                <p style="text-align: center; color: #666;">Nenhum dispositivo vinculado.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = state.devices.map(device => `
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin: 0;">
                        ${device.name}
                        <span class="badge badge-${device.online ? 'success' : 'secondary'}">
                            ${device.online ? 'Online' : 'Offline'}
                        </span>
                    </h3>
                    <p style="margin: 5px 0; color: #666;">
                        ID: ${device.device_id} • ${device.pet_count || 0} pets
                    </p>
                    <p style="margin: 5px 0; color: #666; font-size: 12px;">
                        ${device.last_seen ? `Visto: ${new Date(device.last_seen).toLocaleString('pt-BR')}` : ''}
                    </p>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-sm btn-primary" onclick="showEditDeviceModal(${device.id}, '${device.name}')">
                        <i class="fas fa-edit"></i> Editar
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="restartDevice(${device.id})">
                        <i class="fas fa-sync"></i> Reiniciar
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="unlinkDevice(${device.id}, '${device.name}')">
                        <i class="fas fa-unlink"></i> Desvincular
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

// ===================================
// ACTIONS
// ===================================

async function feedPet(petId, deviceId) {
    const pet = state.pets.find(p => p.id === petId);
    if (!pet) return;

    const amount = pet.daily_amount || 50;

    if (!confirm(`Alimentar ${pet.name} com ${amount}g agora?`)) return;

    try {
        const result = await api.feedNow(deviceId, petId, amount);
        if (result.success) {
            showToast(`Comando enviado: ${pet.name} será alimentado`, 'success');
            setTimeout(loadHistory, 2000);
        } else {
            showToast(result.message || 'Erro ao enviar comando', 'error');
        }
    } catch (error) {
        console.error('Feed error:', error);
        showToast(error.message || 'Erro ao alimentar', 'error');
    }
}

// Dose size to grams/steps mapping
// 1 volta = 2048 passos (motor 28BYJ-48)
const DOSE_CONFIG = {
    small: { grams: 50, steps: 2048, voltas: 1, name: 'Pequena' },
    medium: { grams: 100, steps: 4096, voltas: 2, name: 'Média' },
    large: { grams: 150, steps: 6144, voltas: 3, name: 'Grande' }
};

// Update pet info when selecting pet in Feed modal
function updateFeedPetInfo() {
    const petId = parseInt(document.getElementById('feedPetSelect').value);
    const infoBox = document.getElementById('feedPetInfo');

    if (!petId) {
        infoBox.style.display = 'none';
        return;
    }

    const pet = state.pets.find(p => p.id === petId);
    if (pet) {
        const device = state.devices.find(d => d.id === pet.device_id);
        document.getElementById('feedPetDevice').textContent = device ? device.name : 'N/A';
        document.getElementById('feedPetCompartment').textContent = pet.compartment || '1';
        infoBox.style.display = 'block';
    }
}

// Update pet info when selecting pet in Schedule modal
function updateSchedulePetInfo() {
    const petId = parseInt(document.getElementById('schedulePetSelect').value);
    const infoBox = document.getElementById('schedulePetInfo');

    if (!petId) {
        infoBox.style.display = 'none';
        return;
    }

    const pet = state.pets.find(p => p.id === petId);
    if (pet) {
        const device = state.devices.find(d => d.id === pet.device_id);
        document.getElementById('schedulePetDevice').textContent = device ? device.name : 'N/A';
        document.getElementById('schedulePetCompartment').textContent = pet.compartment || '1';
        infoBox.style.display = 'block';
    }
}

async function feedNow() {
    const petId = parseInt(document.getElementById('feedPetSelect').value);
    const doseSize = document.querySelector('input[name="feedDose"]:checked')?.value || 'medium';

    if (!petId) {
        showToast('Selecione um pet', 'error');
        return;
    }

    const pet = state.pets.find(p => p.id === petId);
    if (!pet) {
        showToast('Pet não encontrado', 'error');
        return;
    }

    const dose = DOSE_CONFIG[doseSize];
    const deviceId = pet.device_id;

    try {
        const result = await api.feedNow(deviceId, petId, dose.grams);
        if (result.success) {
            showToast(`${pet.name}: Dose ${dose.name} (${dose.grams}g) enviada!`, 'success');
            closeAllModals();
            setTimeout(loadHistory, 2000);
        } else {
            showToast(result.message || 'Erro ao enviar comando', 'error');
        }
    } catch (error) {
        console.error('Feed error:', error);
        showToast(error.message || 'Erro ao alimentar', 'error');
    }
}

async function addPet() {
    const deviceId = parseInt(document.getElementById('petDeviceSelect').value);
    const name = document.getElementById('petName').value;
    const type = document.getElementById('petType').value;
    const compartment = parseInt(document.getElementById('petCompartment').value);
    const dailyAmount = parseInt(document.getElementById('petDailyAmount').value) || 100;

    if (!deviceId || !name || !type || !compartment) {
        showToast('Preencha todos os campos obrigatórios', 'error');
        return;
    }

    try {
        const result = await api.createPet({
            device_id: deviceId,
            name,
            type,
            compartment,
            daily_amount: dailyAmount,
        });

        if (result.success) {
            showToast('Pet adicionado com sucesso!', 'success');
            closeAllModals();
            await loadPets();
        } else {
            showToast(result.message || 'Erro ao adicionar pet', 'error');
        }
    } catch (error) {
        console.error('Add pet error:', error);
        showToast(error.message || 'Erro ao adicionar pet', 'error');
    }
}

async function deletePet(petId, petName) {
    if (!confirm(`Deseja realmente remover ${petName}?`)) return;

    try {
        const result = await api.deletePet(petId);
        if (result.success) {
            showToast('Pet removido', 'success');
            await loadPets();
        } else {
            showToast(result.message || 'Erro ao remover pet', 'error');
        }
    } catch (error) {
        console.error('Delete pet error:', error);
        showToast(error.message || 'Erro ao remover pet', 'error');
    }
}

async function addSchedule() {
    const petId = parseInt(document.getElementById('schedulePetSelect').value);
    const timeValue = document.getElementById('scheduleTime').value;
    const doseSize = document.querySelector('input[name="scheduleDose"]:checked')?.value || 'medium';

    if (!petId) {
        showToast('Selecione um pet', 'error');
        return;
    }

    if (!timeValue) {
        showToast('Defina um horário', 'error');
        return;
    }

    const pet = state.pets.find(p => p.id === petId);
    if (!pet) {
        showToast('Pet não encontrado', 'error');
        return;
    }

    const [hour, minute] = timeValue.split(':').map(Number);
    const dose = DOSE_CONFIG[doseSize];
    const deviceId = pet.device_id;

    // Get weekday selection (new IDs)
    const weekdays = {
        monday: document.getElementById('day_mon')?.checked ?? true,
        tuesday: document.getElementById('day_tue')?.checked ?? true,
        wednesday: document.getElementById('day_wed')?.checked ?? true,
        thursday: document.getElementById('day_thu')?.checked ?? true,
        friday: document.getElementById('day_fri')?.checked ?? true,
        saturday: document.getElementById('day_sat')?.checked ?? true,
        sunday: document.getElementById('day_sun')?.checked ?? true,
    };

    try {
        const result = await api.createSchedule({
            device_id: deviceId,
            pet_id: petId,
            hour,
            minute,
            amount: dose.grams,
            dose_size: doseSize,
            active: true,
            weekdays,
        });

        if (result.success) {
            showToast(`Horário ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} criado para ${pet.name}!`, 'success');
            closeAllModals();
            await loadSchedules();
        } else {
            showToast(result.message || 'Erro ao criar horário', 'error');
        }
    } catch (error) {
        console.error('Add schedule error:', error);
        showToast(error.message || 'Erro ao criar horário', 'error');
    }
}

async function toggleSchedule(scheduleId, active) {
    try {
        const result = await api.updateSchedule(scheduleId, { active });
        if (result.success) {
            showToast(`Horário ${active ? 'ativado' : 'desativado'}`, 'success');
            await loadSchedules();
        } else {
            showToast(result.message || 'Erro ao atualizar horário', 'error');
        }
    } catch (error) {
        console.error('Toggle schedule error:', error);
        showToast(error.message || 'Erro ao atualizar horário', 'error');
    }
}

async function deleteSchedule(scheduleId) {
    if (!confirm('Deseja realmente remover este horário?')) return;

    try {
        const result = await api.deleteSchedule(scheduleId);
        if (result.success) {
            showToast('Horário removido', 'success');
            await loadSchedules();
        } else {
            showToast(result.message || 'Erro ao remover horário', 'error');
        }
    } catch (error) {
        console.error('Delete schedule error:', error);
        showToast(error.message || 'Erro ao remover horário', 'error');
    }
}

async function linkDevice() {
    const deviceId = document.getElementById('deviceId').value.trim();
    const deviceName = document.getElementById('deviceName').value.trim();

    if (!deviceId || !deviceName) {
        showToast('Preencha todos os campos', 'error');
        return;
    }

    try {
        const result = await api.linkDevice(deviceId, deviceName);
        if (result.success) {
            showToast('Dispositivo vinculado com sucesso!', 'success');
            closeAllModals();
            await loadDevices();
        } else {
            showToast(result.message || 'Erro ao vincular dispositivo', 'error');
        }
    } catch (error) {
        console.error('Link device error:', error);
        showToast(error.message || 'Erro ao vincular dispositivo', 'error');
    }
}

async function unlinkDevice(deviceId, deviceName) {
    if (!confirm(`Deseja realmente desvincular ${deviceName}?`)) return;

    try {
        const result = await api.deleteDevice(deviceId);
        if (result.success) {
            showToast('Dispositivo desvinculado', 'success');
            await loadDevices();
            await loadPets();
        } else {
            showToast(result.message || 'Erro ao desvincular dispositivo', 'error');
        }
    } catch (error) {
        console.error('Unlink device error:', error);
        showToast(error.message || 'Erro ao desvincular dispositivo', 'error');
    }
}

async function restartDevice(deviceId) {
    if (!confirm('Deseja realmente reiniciar este dispositivo?')) return;

    try {
        const result = await api.restartDevice(deviceId);
        if (result.success) {
            showToast('Comando de reinicialização enviado', 'success');
        } else {
            showToast(result.message || 'Erro ao reiniciar dispositivo', 'error');
        }
    } catch (error) {
        console.error('Restart device error:', error);
        showToast(error.message || 'Erro ao reiniciar dispositivo', 'error');
    }
}

// Edit Device
function showEditDeviceModal(deviceId, deviceName) {
    document.getElementById('editDeviceId').value = deviceId;
    document.getElementById('editDeviceName').value = deviceName;
    showModal('editDeviceModal');
}

async function saveDeviceEdit() {
    const deviceId = document.getElementById('editDeviceId').value;
    const name = document.getElementById('editDeviceName').value.trim();

    if (!name) {
        showToast('Digite um nome para o dispositivo', 'error');
        return;
    }

    try {
        const result = await api.updateDevice(deviceId, { name });
        if (result.success) {
            showToast('Dispositivo atualizado!', 'success');
            closeAllModals();
            await loadDevices();
        } else {
            showToast(result.message || 'Erro ao atualizar dispositivo', 'error');
        }
    } catch (error) {
        console.error('Edit device error:', error);
        showToast(error.message || 'Erro ao atualizar dispositivo', 'error');
    }
}

// ===================================
// UI HELPERS
// ===================================

function switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    // Show selected tab
    document.querySelector(`.tab[onclick="switchTab('${tabName}')"]`).classList.add('active');
    document.getElementById(`${tabName}Tab`).classList.add('active');

    // Load data if needed
    if (tabName === 'history') {
        loadHistory();
    }
}

function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('currentTime').textContent = timeStr;
}

function updateConnectionStatus() {
    const status = document.getElementById('connectionStatus');
    const icon = document.getElementById('wifiStatus');

    if (ws && ws.isConnected()) {
        status.textContent = 'Conectado';
        icon.className = 'fas fa-wifi';
        icon.style.color = '#48bb78';
    } else {
        status.textContent = 'Desconectado';
        icon.className = 'fas fa-wifi';
        icon.style.color = '#f56565';
    }
}

function updateDeviceSelects() {
    const selects = [
        'feedDeviceSelect',
        'petDeviceSelect',
        'scheduleDeviceSelect',
        'historyDeviceFilter',
    ];

    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;

        const currentValue = select.value;
        select.innerHTML = '<option value="">Selecione...</option>' +
            state.devices.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
        select.value = currentValue;
    });
}

function updatePetSelects() {
    const select = document.getElementById('historyPetFilter');
    if (select) {
        const currentValue = select.value;
        select.innerHTML = '<option value="">Todos os pets</option>' +
            state.pets.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        select.value = currentValue;
    }
}

function updatePetSelectForFeeding() {
    const deviceId = parseInt(document.getElementById('feedDeviceSelect').value);
    const select = document.getElementById('feedPetSelect');

    if (!deviceId) {
        select.innerHTML = '<option value="">Selecione...</option>';
        return;
    }

    const devicePets = state.pets.filter(p => p.device_id === deviceId);
    select.innerHTML = '<option value="">Selecione...</option>' +
        devicePets.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

function updatePetSelectForSchedule() {
    const deviceId = parseInt(document.getElementById('scheduleDeviceSelect').value);
    const select = document.getElementById('schedulePetSelect');

    if (!deviceId) {
        select.innerHTML = '<option value="">Selecione...</option>';
        return;
    }

    const devicePets = state.pets.filter(p => p.device_id === deviceId);
    select.innerHTML = '<option value="">Selecione...</option>' +
        devicePets.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

// ===================================
// MODALS
// ===================================

// Populate pet select with all pets
function updatePetSelects() {
    const petSelects = ['feedPetSelect', 'schedulePetSelect'];

    petSelects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            select.innerHTML = '<option value="">Selecione um pet...</option>' +
                state.pets.map(p => {
                    const device = state.devices.find(d => d.id === p.device_id);
                    const deviceName = device ? ` (${device.name})` : '';
                    const emoji = getPetEmoji(p.type);
                    return `<option value="${p.id}">${emoji} ${p.name}${deviceName}</option>`;
                }).join('');
        }
    });
}

function showFeedNowModal() {
    updatePetSelects();
    // Reset form
    document.getElementById('feedPetSelect').value = '';
    document.getElementById('feedPetInfo').style.display = 'none';
    document.querySelector('input[name="feedDose"][value="small"]').checked = true;

    document.getElementById('modalOverlay').classList.add('active');
    document.getElementById('feedNowModal').classList.add('active');
}

function showAddPetModal() {
    updateDeviceSelects();
    // Reset form
    document.getElementById('petDeviceSelect').value = '';
    document.getElementById('petName').value = '';
    document.getElementById('petType').value = 'cat';
    document.getElementById('petCompartment').value = '1';
    document.getElementById('petDailyAmount').value = '100';

    document.getElementById('modalOverlay').classList.add('active');
    document.getElementById('addPetModal').classList.add('active');
}

function showAddScheduleModal() {
    updatePetSelects();
    // Reset form
    document.getElementById('schedulePetSelect').value = '';
    document.getElementById('schedulePetInfo').style.display = 'none';
    document.getElementById('scheduleTime').value = '';
    document.querySelector('input[name="scheduleDose"][value="medium"]').checked = true;
    // Reset all days to checked
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach(day => {
        const checkbox = document.getElementById(`day_${day}`);
        if (checkbox) checkbox.checked = true;
    });

    document.getElementById('modalOverlay').classList.add('active');
    document.getElementById('addScheduleModal').classList.add('active');
}

function showLinkDeviceModal() {
    // Reset form
    document.getElementById('deviceId').value = '';
    document.getElementById('deviceName').value = '';

    document.getElementById('modalOverlay').classList.add('active');
    document.getElementById('linkDeviceModal').classList.add('active');
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => modal.classList.remove('active'));
    document.getElementById('modalOverlay').classList.remove('active');
}

// ===================================
// TOAST NOTIFICATIONS
// ===================================

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const icons = {
        success: 'check-circle',
        error: 'exclamation-circle',
        warning: 'exclamation-triangle',
        info: 'info-circle',
    };

    toast.innerHTML = `<i class="fas fa-${icons[type]}"></i> ${message}`;
    toast.className = `toast toast-${type} show`;

    setTimeout(() => {
        toast.classList.remove('show');
    }, CONFIG.TOAST_DURATION);
}

// ===================================
// HELPERS
// ===================================

function getPetEmoji(type) {
    const emojis = {
        cat: '🐱',
        dog: '🐶',
        other: '🐾',
    };
    return emojis[type] || '🐾';
}

function getPetTypeLabel(type) {
    const labels = {
        cat: 'Gato',
        dog: 'Cachorro',
        other: 'Outro',
    };
    return labels[type] || type;
}

function getTriggerLabel(trigger) {
    const labels = {
        manual: 'Manual',
        scheduled: 'Programado',
        app: 'Aplicativo',
        button: 'Botão',
        voice: 'Voz',
        api: 'API',
        presence: 'Presença',
    };
    return labels[trigger] || trigger;
}

// ===================================
// DEVICE TOKEN
// ===================================

// Mostra o email do usuário para configurar ESP32
function loadUserEmail() {
    const emailInput = document.getElementById('userEmail');
    if (emailInput && state.user && state.user.email) {
        emailInput.value = state.user.email;
    }
}

function copyUserEmail() {
    const emailInput = document.getElementById('userEmail');
    if (emailInput && emailInput.value) {
        navigator.clipboard.writeText(emailInput.value).then(() => {
            showToast('Email copiado!', 'success');
        }).catch(err => {
            // Fallback for older browsers
            emailInput.select();
            document.execCommand('copy');
            showToast('Email copiado!', 'success');
        });
    }
}
