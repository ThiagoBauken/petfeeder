// =============== GLOBAL VARIABLES ===============
let ws = null;
let reconnectInterval = null;
let devices = []; // Lista de dispositivos ESP32
let systemData = {
    pets: [],
    schedules: [],
    levels: {},
    status: {},
    history: [],
    feedingHistory: [], // Real feeding history
    consumptionData: {
        daily: [0, 0, 0, 0, 0, 0, 0] // Last 7 days
    }
};

// =============== WEBSOCKET CONNECTION ===============
function initWebSocket() {
    const wsUrl = `ws://${window.location.hostname}/ws`;
    console.log('Connecting to WebSocket:', wsUrl);
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = function() {
        console.log('WebSocket connected');
        clearInterval(reconnectInterval);
        document.getElementById('wifi-icon').classList.add('connected');
        document.getElementById('wifi-icon').classList.remove('disconnected');
        document.getElementById('wifi-status').textContent = 'Conectado';
        
        // Request initial data
        ws.send(JSON.stringify({ action: 'getStatus' }));
        ws.send(JSON.stringify({ action: 'getHistory' }));
    };
    
    ws.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };
    
    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
    };
    
    ws.onclose = function() {
        console.log('WebSocket disconnected');
        document.getElementById('wifi-icon').classList.remove('connected');
        document.getElementById('wifi-icon').classList.add('disconnected');
        document.getElementById('wifi-status').textContent = 'Desconectado';
        
        // Try to reconnect
        reconnectInterval = setInterval(() => {
            console.log('Attempting to reconnect...');
            initWebSocket();
        }, 5000);
    };
}

function handleWebSocketMessage(data) {
    switch(data.type) {
        case 'status':
            updateSystemStatus(data);
            break;
        case 'history':
            updateHistory(data.history);
            break;
        case 'alert':
            showNotification(data.title, data.message, data.level);
            break;
        case 'feeding':
            handleFeedingUpdate(data);
            break;
    }
}

function sendWebSocketMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    } else {
        console.error('WebSocket is not connected');
        showNotification('Erro', 'Conexão perdida. Tentando reconectar...', 'error');
    }
}

// =============== TAB MANAGEMENT ===============
document.addEventListener('DOMContentLoaded', function() {
    // Initialize WebSocket
    initWebSocket();

    // Setup tab navigation
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');

            // Update active button
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // Update active content
            tabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(`${targetTab}-tab`).classList.add('active');
        });
    });

    // Setup form handlers
    setupFormHandlers();

    // Initialize schedules
    loadSchedules();

    // Load history from localStorage
    loadHistoryFromStorage();

    // Update time
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000);

    // Setup chart
    setupConsumptionChart();
});

// =============== SYSTEM STATUS UPDATES ===============
function updateSystemStatus(data) {
    // Update levels
    if (data.level1 !== undefined) {
        updateLevel(1, data.level1);
    }
    if (data.level2 !== undefined) {
        updateLevel(2, data.level2);
    }
    if (data.level3 !== undefined) {
        updateLevel(3, data.level3);
    }
    
    // Update temperature
    if (data.temperature !== undefined) {
        document.getElementById('temperature').textContent = `${data.temperature.toFixed(1)}°C`;
    }
    
    // Update uptime
    if (data.uptime !== undefined) {
        const hours = Math.floor(data.uptime / 3600);
        const minutes = Math.floor((data.uptime % 3600) / 60);
        document.getElementById('uptime').textContent = `${hours}h ${minutes}m`;
    }
    
    // Update total dispensed
    if (data.totalToday !== undefined) {
        document.getElementById('total-dispensed').textContent = `${data.totalToday}g`;
    }
    
    // Update last feeding
    if (data.lastFeed) {
        document.querySelectorAll('[id$="-last-feed"]').forEach(el => {
            el.textContent = data.lastFeed;
        });
    }
    
    // Update pets info
    if (data.pets) {
        data.pets.forEach((pet, index) => {
            const petNum = index + 1;
            document.getElementById(`pet${petNum}-name`).textContent = pet.name;
            document.getElementById(`pet${petNum}-today`).textContent = `${pet.todayAmount || 0}g`;
            
            // Update config forms
            document.getElementById(`pet${petNum}-config-name`).value = pet.name;
            document.getElementById(`pet${petNum}-daily`).value = pet.daily;
            document.getElementById(`pet${petNum}-portion`).value = pet.portion;
            document.getElementById(`pet${petNum}-status`).value = pet.active ? 'active' : 'inactive';
        });
    }
}

function updateLevel(compartment, percentage) {
    // Update percentage text
    document.getElementById(`level${compartment}-percent`).textContent = `${percentage}%`;
    
    // Update bar width
    const bar = document.getElementById(`level${compartment}-bar`);
    bar.style.width = `${percentage}%`;
    
    // Update color based on level
    if (percentage < 20) {
        bar.style.background = 'linear-gradient(90deg, #f56565, #fc8181)';
    } else if (percentage < 50) {
        bar.style.background = 'linear-gradient(90deg, #ed8936, #f6ad55)';
    }
    
    // Estimate weight (assuming 1kg full capacity)
    const weight = (percentage / 100) * 1000;
    document.getElementById(`level${compartment}-weight`).textContent = `~${Math.round(weight)}g`;
    
    // Show alert if low
    if (percentage < 20) {
        const petName = document.getElementById(`pet${compartment}-name`).textContent;
        showNotification('Nível Baixo', `Compartimento ${compartment} (${petName}) está com pouca ração!`, 'warning');
    }
}

// =============== FEEDING FUNCTIONS ===============
function feedPet(petId) {
    showLoading();
    
    // Add feeding animation to button
    const button = document.querySelector(`.pet-card[data-pet="${petId}"] .feed-btn`);
    button.classList.add('feeding-active');
    
    sendWebSocketMessage({
        action: 'feed',
        petId: petId
    });
    
    // Remove animation after 3 seconds
    setTimeout(() => {
        button.classList.remove('feeding-active');
        hideLoading();
    }, 3000);
}

function feedAll() {
    if (confirm('Alimentar todos os pets agora?')) {
        // Feed all active pets
        for (let i = 1; i <= 3; i++) {
            const statusEl = document.getElementById(`pet${i}-status`);
            if (statusEl && statusEl.value === 'active') {
                window.feedPet(i);
            }
        }
    }
}

function testDispenser() {
    if (confirm('Isso irá dispensar uma pequena quantidade (5g) de teste. Escolha qual motor testar.')) {
        const motor = prompt('Qual motor testar? (1, 2 ou 3):');
        if (motor && ['1', '2', '3'].includes(motor)) {
            // Find device with this motor
            devices.forEach(device => {
                const motorIndex = parseInt(motor) - 1;
                if (device.motors && device.motors[motorIndex] && device.motors[motorIndex].active) {
                    sendWebSocketMessage({
                        action: 'test',
                        deviceId: device.id,
                        motorIndex: motorIndex,
                        amount: 5
                    });
                    showNotification('Teste', `Testando motor ${motor} com 5g...`, 'info');
                }
            });
        }
    }
}

function emergencyStop() {
    if (confirm('PARADA DE EMERGÊNCIA - Isso irá parar todos os motores imediatamente. Continuar?')) {
        devices.forEach(device => {
            sendWebSocketMessage({
                action: 'emergencyStop',
                deviceId: device.id
            });
        });
        showNotification('Parada de Emergência', 'Todos os motores foram parados!', 'warning');
    }
}

function calibrateServos() {
    showNotification('Calibração', 'Use a aba "Dispositivos" para calibrar motores individuais, ou a aba "Configurações" para calibração global.', 'info');
}

function saveMotorCalibration() {
    const stepsPerGram = parseFloat(document.getElementById('steps-per-gram').value);
    const motorSpeed = parseInt(document.getElementById('motor-speed').value);

    if (!stepsPerGram || !motorSpeed) {
        showNotification('Erro', 'Preencha todos os campos de calibração', 'error');
        return;
    }

    // Send to all devices
    devices.forEach(device => {
        sendWebSocketMessage({
            action: 'updateCalibration',
            deviceId: device.id,
            stepsPerGram: stepsPerGram,
            motorSpeed: motorSpeed
        });
    });

    // Save to localStorage
    localStorage.setItem('motor_calibration', JSON.stringify({
        stepsPerGram,
        motorSpeed
    }));

    showNotification('Calibração Salva',
        `Steps/Grama: ${stepsPerGram}, Velocidade: ${motorSpeed}µs`,
        'success');
}

// Load calibration on init
function loadMotorCalibration() {
    const saved = localStorage.getItem('motor_calibration');
    if (saved) {
        try {
            const { stepsPerGram, motorSpeed } = JSON.parse(saved);
            const stepsInput = document.getElementById('steps-per-gram');
            const speedInput = document.getElementById('motor-speed');

            if (stepsInput) stepsInput.value = stepsPerGram;
            if (speedInput) speedInput.value = motorSpeed;
        } catch (e) {
            console.error('Error loading calibration:', e);
        }
    }
}

function handleFeedingUpdate(data) {
    const petName = document.getElementById(`pet${data.petId}-name`).textContent;
    showNotification('Alimentação', `${petName} foi alimentado com ${data.amount}g`, 'success');
    
    // Update today's total
    const todayEl = document.getElementById(`pet${data.petId}-today`);
    const currentAmount = parseFloat(todayEl.textContent);
    todayEl.textContent = `${currentAmount + data.amount}g`;
}

// =============== SCHEDULE MANAGEMENT ===============
function loadSchedules() {
    const scheduleList = document.getElementById('schedule-list');
    const template = document.getElementById('schedule-template');
    
    // Load default schedules (will be replaced by server data)
    const defaultSchedules = [
        { time: '07:00', petId: 0, amount: 20, days: [true, true, true, true, true, true, true] },
        { time: '12:00', petId: 0, amount: 15, days: [true, true, true, true, true, true, true] },
        { time: '19:00', petId: 0, amount: 25, days: [true, true, true, true, true, true, true] }
    ];
    
    defaultSchedules.forEach((schedule, index) => {
        const clone = template.content.cloneNode(true);
        const item = clone.querySelector('.schedule-item');
        item.setAttribute('data-schedule-id', index);
        
        // Set values
        clone.querySelector('.time-input').value = schedule.time;
        clone.querySelector('.pet-select').value = schedule.petId;
        clone.querySelector('.amount-input').value = schedule.amount;
        
        // Set days
        const dayCheckboxes = clone.querySelectorAll('.day-checkbox input');
        schedule.days.forEach((enabled, dayIndex) => {
            dayCheckboxes[dayIndex].checked = enabled;
        });
        
        scheduleList.appendChild(clone);
    });
}

function addNewSchedule() {
    const scheduleList = document.getElementById('schedule-list');
    const template = document.getElementById('schedule-template');
    const clone = template.content.cloneNode(true);
    
    const newId = scheduleList.children.length;
    clone.querySelector('.schedule-item').setAttribute('data-schedule-id', newId);
    
    scheduleList.appendChild(clone);
    
    // Save to server
    saveSchedule(newId);
}

function toggleSchedule(button) {
    const item = button.closest('.schedule-item');
    const scheduleId = item.getAttribute('data-schedule-id');
    const isActive = button.classList.contains('active');
    
    if (isActive) {
        button.classList.remove('active');
        button.classList.add('inactive');
        button.innerHTML = '<i class="fas fa-toggle-off"></i>';
        item.classList.add('disabled');
    } else {
        button.classList.remove('inactive');
        button.classList.add('active');
        button.innerHTML = '<i class="fas fa-toggle-on"></i>';
        item.classList.remove('disabled');
    }
    
    saveSchedule(scheduleId);
}

function deleteSchedule(button) {
    if (confirm('Remover este horário?')) {
        const item = button.closest('.schedule-item');
        const scheduleId = item.getAttribute('data-schedule-id');
        
        sendWebSocketMessage({
            action: 'deleteSchedule',
            scheduleId: scheduleId
        });
        
        item.remove();
    }
}

function saveSchedule(scheduleId) {
    const item = document.querySelector(`.schedule-item[data-schedule-id="${scheduleId}"]`);
    const time = item.querySelector('.time-input').value;
    const [hour, minute] = time.split(':').map(Number);
    const petId = parseInt(item.querySelector('.pet-select').value);
    const amount = parseFloat(item.querySelector('.amount-input').value);
    const isActive = item.querySelector('.toggle-btn').classList.contains('active');
    
    const weekdays = [];
    item.querySelectorAll('.day-checkbox input').forEach(checkbox => {
        weekdays.push(checkbox.checked);
    });
    
    sendWebSocketMessage({
        action: 'updateSchedule',
        scheduleId: scheduleId,
        hour: hour,
        minute: minute,
        petId: petId,
        amount: amount,
        isActive: isActive,
        weekdays: weekdays
    });
}

// =============== HISTORY MANAGEMENT ===============
function updateHistory(historyData) {
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;

    // Store in global state
    systemData.feedingHistory = historyData || [];

    tbody.innerHTML = '';

    if (systemData.feedingHistory.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 2rem; color: #718096;">
                    <i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 0.5rem; display: block;"></i>
                    Nenhuma alimentação registrada ainda.<br>
                    <small>As alimentações aparecerão aqui automaticamente.</small>
                </td>
            </tr>
        `;
        return;
    }

    systemData.feedingHistory.forEach(entry => {
        const row = document.createElement('tr');
        const petName = entry.petName || `Pet ${entry.petId}`;
        const timestamp = entry.timestamp ? new Date(entry.timestamp).toLocaleString('pt-BR') : entry.time;
        const status = entry.success !== false ? '✓ Completo' : '✗ Falhou';
        const statusClass = entry.success !== false ? 'success' : 'danger';

        row.innerHTML = `
            <td>${timestamp}</td>
            <td>${petName}</td>
            <td>${entry.amount}g</td>
            <td>${getTypeLabel(entry.type || 'manual')}</td>
            <td><span class="${statusClass}">${status}</span></td>
        `;

        tbody.appendChild(row);
    });

    // Update consumption data
    updateConsumptionData();
    setupConsumptionChart();
}

// Add feeding to history
function addToHistory(petId, amount, type = 'manual', success = true) {
    const timestamp = new Date();
    const petName = document.getElementById(`pet${petId}-name`)?.textContent || `Pet ${petId}`;

    const entry = {
        timestamp: timestamp.toISOString(),
        time: timestamp.toLocaleString('pt-BR'),
        petId: petId,
        petName: petName,
        amount: amount,
        type: type,
        success: success
    };

    systemData.feedingHistory.unshift(entry); // Add to beginning

    // Keep only last 100 entries
    if (systemData.feedingHistory.length > 100) {
        systemData.feedingHistory = systemData.feedingHistory.slice(0, 100);
    }

    // Save to localStorage
    localStorage.setItem('petfeeder_history', JSON.stringify(systemData.feedingHistory));

    // Update display
    updateHistory(systemData.feedingHistory);
}

// Load history from localStorage
function loadHistoryFromStorage() {
    const saved = localStorage.getItem('petfeeder_history');
    if (saved) {
        try {
            systemData.feedingHistory = JSON.parse(saved);
            updateHistory(systemData.feedingHistory);
        } catch (e) {
            console.error('Error loading history:', e);
        }
    }
}

// Update consumption data for chart
function updateConsumptionData() {
    const now = new Date();
    const dailyTotals = [0, 0, 0, 0, 0, 0, 0]; // Last 7 days

    systemData.feedingHistory.forEach(entry => {
        const entryDate = new Date(entry.timestamp);
        const daysDiff = Math.floor((now - entryDate) / (1000 * 60 * 60 * 24));

        if (daysDiff >= 0 && daysDiff < 7) {
            dailyTotals[6 - daysDiff] += parseFloat(entry.amount) || 0;
        }
    });

    systemData.consumptionData.daily = dailyTotals;
}

function getTypeLabel(type) {
    const labels = {
        'scheduled': 'Programado',
        'manual': 'Manual',
        'presence': 'Presença'
    };
    return labels[type] || type;
}

function exportHistory() {
    // Get history data
    const rows = document.querySelectorAll('#history-tbody tr');
    let csv = 'Data/Hora,Pet,Quantidade,Tipo,Status\n';
    
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        csv += `${cells[0].textContent},${cells[1].textContent},${cells[2].textContent},${cells[3].textContent},${cells[4].textContent}\n`;
    });
    
    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `historico_alimentacao_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    
    showNotification('Exportação', 'Histórico exportado com sucesso!', 'success');
}

// =============== FORM HANDLERS ===============
function setupFormHandlers() {
    // Pet configuration forms
    for (let i = 1; i <= 3; i++) {
        const form = document.getElementById(`pet${i}-form`);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            savePetConfig(i);
        });
    }
    
    // WiFi form
    const wifiForm = document.getElementById('wifi-form');
    if (wifiForm) {
        wifiForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveWiFiSettings();
        });
    }
    
    // Notification form
    const notificationForm = document.getElementById('notification-form');
    if (notificationForm) {
        notificationForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveNotificationSettings();
        });
    }
}

function savePetConfig(petId) {
    const name = document.getElementById(`pet${petId}-config-name`).value;
    const dailyAmount = parseFloat(document.getElementById(`pet${petId}-daily`).value);
    const mealsPerDay = parseInt(document.getElementById(`pet${petId}-meals`).value);
    const portionSize = parseFloat(document.getElementById(`pet${petId}-portion`).value);
    const isActive = document.getElementById(`pet${petId}-status`).value === 'active';
    
    sendWebSocketMessage({
        action: 'updatePet',
        petId: petId,
        name: name,
        dailyAmount: dailyAmount,
        mealsPerDay: mealsPerDay,
        portionSize: portionSize,
        isActive: isActive
    });
    
    // Update UI
    document.getElementById(`pet${petId}-name`).textContent = name;
    
    showNotification('Configuração Salva', `Configurações de ${name} foram atualizadas!`, 'success');
}

function saveWiFiSettings() {
    const ssid = document.getElementById('wifi-ssid').value;
    const password = document.getElementById('wifi-password').value;
    
    if (confirm('Alterar configurações WiFi pode desconectar o sistema temporariamente. Continuar?')) {
        sendWebSocketMessage({
            action: 'updateWiFi',
            ssid: ssid,
            password: password
        });
        
        showNotification('WiFi', 'Configurações WiFi atualizadas. Reconectando...', 'info');
    }
}

function saveNotificationSettings() {
    const enabled = document.getElementById('enable-notifications').checked;
    const telegramToken = document.getElementById('telegram-token').value;
    const telegramChatId = document.getElementById('telegram-chat-id').value;
    const threshold = parseInt(document.getElementById('low-level-threshold').value);
    
    sendWebSocketMessage({
        action: 'updateNotifications',
        enabled: enabled,
        telegramToken: telegramToken,
        telegramChatId: telegramChatId,
        lowLevelThreshold: threshold
    });
    
    showNotification('Notificações', 'Configurações de notificação atualizadas!', 'success');
}

// =============== CALIBRATION ===============
// Motor calibration is now handled by saveMotorCalibration() and loadMotorCalibration()

// =============== SYSTEM ACTIONS ===============
function resetSystem() {
    if (confirm('Reiniciar o sistema?')) {
        sendWebSocketMessage({
            action: 'reset'
        });
        showNotification('Sistema', 'Reiniciando...', 'info');
    }
}

function factoryReset() {
    if (confirm('ATENÇÃO: Isso apagará todas as configurações. Continuar?')) {
        if (confirm('Tem certeza? Esta ação não pode ser desfeita!')) {
            sendWebSocketMessage({
                action: 'factoryReset'
            });
            showNotification('Reset', 'Sistema restaurado para configurações de fábrica', 'warning');
        }
    }
}

function backupSettings() {
    sendWebSocketMessage({
        action: 'backup'
    });
    
    // Server will send back the configuration data
    setTimeout(() => {
        // Create download link for backup
        const config = JSON.stringify(systemData, null, 2);
        const blob = new Blob([config], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `petfeeder_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        
        showNotification('Backup', 'Backup criado com sucesso!', 'success');
    }, 1000);
}

function restoreSettings() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    
    input.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        
        reader.onload = (event) => {
            try {
                const config = JSON.parse(event.target.result);
                sendWebSocketMessage({
                    action: 'restore',
                    config: config
                });
                
                showNotification('Restauração', 'Configurações restauradas com sucesso!', 'success');
            } catch (error) {
                showNotification('Erro', 'Arquivo de backup inválido!', 'error');
            }
        };
        
        reader.readAsText(file);
    };
    
    input.click();
}

function updateFirmware() {
    showNotification('Firmware', 'Verificando atualizações...', 'info');
    
    sendWebSocketMessage({
        action: 'checkUpdate'
    });
}

// =============== CHART SETUP ===============
function setupConsumptionChart() {
    const canvas = document.getElementById('consumption-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Get day labels
    const today = new Date();
    const days = [];
    const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        days.push(dayNames[d.getDay()]);
    }

    // Use real data
    const data = systemData.consumptionData.daily;
    const maxValue = Math.max(...data, 100); // Minimum scale of 100g

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const chartWidth = canvas.width;
    const chartHeight = canvas.height;
    const barWidth = (chartWidth / days.length) * 0.7;
    const spacing = (chartWidth / days.length) * 0.15;

    // Draw bars
    data.forEach((value, index) => {
        const barHeight = maxValue > 0 ? (value / maxValue) * (chartHeight - 50) : 0;
        const x = (index * (barWidth + spacing)) + spacing;
        const y = chartHeight - barHeight - 30;

        // Gradient for bars
        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        gradient.addColorStop(0, '#667eea');
        gradient.addColorStop(1, '#764ba2');

        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, barWidth, barHeight);

        // Draw value on top
        if (value > 0) {
            ctx.fillStyle = '#2d3748';
            ctx.font = 'bold 11px Poppins';
            ctx.textAlign = 'center';
            ctx.fillText(Math.round(value) + 'g', x + barWidth / 2, y - 5);
        }

        // Draw day label
        ctx.fillStyle = '#718096';
        ctx.font = '12px Poppins';
        ctx.textAlign = 'center';
        ctx.fillText(days[index], x + barWidth / 2, chartHeight - 10);
    });

    // Draw message if no data
    if (data.every(v => v === 0)) {
        ctx.fillStyle = '#718096';
        ctx.font = '14px Poppins';
        ctx.textAlign = 'center';
        ctx.fillText('Nenhum dado de consumo ainda', chartWidth / 2, chartHeight / 2);
    }
}

// =============== UTILITY FUNCTIONS ===============
function updateCurrentTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('current-time').textContent = `${hours}:${minutes}`;
    
    // Update next scheduled feeding
    updateNextScheduled();
}

function updateNextScheduled() {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    const schedules = document.querySelectorAll('.schedule-item:not(.disabled)');
    let nextTime = null;
    let minDiff = 24 * 60; // Maximum minutes in a day
    
    schedules.forEach(schedule => {
        const time = schedule.querySelector('.time-input').value;
        const [hours, minutes] = time.split(':').map(Number);
        const scheduleMinutes = hours * 60 + minutes;
        
        let diff = scheduleMinutes - currentMinutes;
        if (diff < 0) diff += 24 * 60; // Next day
        
        if (diff < minDiff) {
            minDiff = diff;
            nextTime = time;
        }
    });
    
    if (nextTime) {
        document.getElementById('next-scheduled').textContent = nextTime;
    }
}

function showNotification(title, message, level = 'info') {
    const modal = document.getElementById('notification-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    
    // Set color based on level
    if (level === 'success') {
        modalTitle.style.color = '#48bb78';
    } else if (level === 'warning') {
        modalTitle.style.color = '#ed8936';
    } else if (level === 'error') {
        modalTitle.style.color = '#f56565';
    } else {
        modalTitle.style.color = '#4299e1';
    }
    
    modal.classList.add('show');
    
    // Auto close after 5 seconds
    setTimeout(() => {
        closeModal();
    }, 5000);
}

function closeModal() {
    const modal = document.getElementById('notification-modal');
    modal.classList.remove('show');
}

function showLoading() {
    document.getElementById('loading-overlay').classList.add('show');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.remove('show');
}

// =============== EVENT LISTENERS ===============
// Close modal when clicking X
document.querySelector('.close').addEventListener('click', closeModal);

// Close modal when clicking outside
window.addEventListener('click', (e) => {
    const modal = document.getElementById('notification-modal');
    if (e.target === modal) {
        closeModal();
    }
});

// Filter history
document.getElementById('history-filter-pet').addEventListener('change', filterHistory);
document.getElementById('history-filter-type').addEventListener('change', filterHistory);

function filterHistory() {
    const petFilter = document.getElementById('history-filter-pet').value;
    const typeFilter = document.getElementById('history-filter-type').value;
    const rows = document.querySelectorAll('#history-tbody tr');
    
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        const petName = cells[1].textContent;
        const type = cells[3].textContent;
        
        let showRow = true;
        
        if (petFilter !== 'all') {
            const filterPetName = petFilter === '1' ? 'Felix' :
                                 petFilter === '2' ? 'Luna' :
                                 petFilter === '3' ? 'Max' : 'Todos';
            if (petName !== filterPetName) showRow = false;
        }
        
        if (typeFilter !== 'all') {
            const filterType = getTypeLabel(typeFilter);
            if (type !== filterType) showRow = false;
        }
        
        row.style.display = showRow ? '' : 'none';
    });
}

// Auto-save schedule changes
document.addEventListener('change', (e) => {
    if (e.target.closest('.schedule-item')) {
        const item = e.target.closest('.schedule-item');
        const scheduleId = item.getAttribute('data-schedule-id');
        if (scheduleId) {
            saveSchedule(scheduleId);
        }
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl+S to save current form
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        const activeForm = document.querySelector('.tab-content.active form');
        if (activeForm) {
            activeForm.dispatchEvent(new Event('submit'));
        }
    }
    
    // F5 to refresh data
    if (e.key === 'F5') {
        e.preventDefault();
        sendWebSocketMessage({ action: 'getStatus' });
        sendWebSocketMessage({ action: 'getHistory' });
        showNotification('Atualização', 'Dados atualizados!', 'success');
    }
});

// =============== DEVICES MANAGEMENT ===============
// Portion sizes mapping
const PORTION_SIZES = {
    small: 15,
    medium: 30,
    large: 50
};

// Initialize portion size handlers
function initPortionHandlers() {
    ['pet1', 'pet2', 'pet3'].forEach(petId => {
        const portionSelect = document.getElementById(`${petId}-portion`);
        const customGroup = document.getElementById(`${petId}-custom-portion-group`);

        if (portionSelect && customGroup) {
            portionSelect.addEventListener('change', function() {
                if (this.value === 'custom') {
                    customGroup.style.display = 'block';
                    customGroup.classList.add('visible');
                } else {
                    customGroup.style.display = 'none';
                    customGroup.classList.remove('visible');
                }
            });
        }
    });
}

// Get portion amount in grams
function getPortionAmount(petId) {
    const portionSelect = document.getElementById(`${petId}-portion`);
    if (!portionSelect) return 30; // default

    const portionType = portionSelect.value;

    if (portionType === 'custom') {
        const customInput = document.getElementById(`${petId}-custom-portion`);
        return parseFloat(customInput?.value || 30);
    }

    return PORTION_SIZES[portionType] || 30;
}

// Load devices from storage or API
function loadDevices() {
    // Try to load from localStorage first
    const savedDevices = localStorage.getItem('petfeeder_devices');
    if (savedDevices) {
        devices = JSON.parse(savedDevices);
        renderDevices();
    }

    // Also request from server via WebSocket
    sendWebSocketMessage({ action: 'getDevices' });
}

// Render devices list
function renderDevices() {
    const devicesList = document.getElementById('devices-list');
    if (!devicesList) return;

    if (devices.length === 0) {
        devicesList.innerHTML = `
            <div class="info-card">
                <i class="fas fa-info-circle"></i>
                <p>Nenhum dispositivo ESP32 configurado. Clique em "Adicionar Novo Dispositivo" para começar.</p>
            </div>
        `;
        return;
    }

    devicesList.innerHTML = devices.map(device => createDeviceCard(device)).join('');
}

// Create device card HTML
function createDeviceCard(device) {
    return `
        <div class="device-card" data-device-id="${device.id}">
            <div class="device-header">
                <div class="device-title">
                    <i class="fas fa-microchip"></i>
                    <h3>${device.name || 'ESP32 - ' + device.id.substring(3, 9)}</h3>
                </div>
                <div class="device-status ${device.online ? 'online' : 'offline'}">
                    <i class="fas fa-circle"></i>
                    <span>${device.online ? 'Online' : 'Offline'}</span>
                </div>
            </div>

            <div class="device-info-grid">
                <div class="device-info-item">
                    <span class="label">Device ID:</span>
                    <span class="value">${device.id}</span>
                </div>
                <div class="device-info-item">
                    <span class="label">IP:</span>
                    <span class="value">${device.ip || '--'}</span>
                </div>
                <div class="device-info-item">
                    <span class="label">RSSI:</span>
                    <span class="value">${device.rssi || '--'} dBm</span>
                </div>
                <div class="device-info-item">
                    <span class="label">Uptime:</span>
                    <span class="value">${device.uptime || '--'}</span>
                </div>
            </div>

            <div class="motors-config">
                <h4><i class="fas fa-cog"></i> Configuração dos Motores</h4>
                ${[1, 2, 3].map(motorNum => createMotorItem(device, motorNum)).join('')}
            </div>

            <div class="device-actions">
                <button class="btn-secondary" onclick="calibrateDevice('${device.id}')">
                    <i class="fas fa-sliders-h"></i> Calibrar
                </button>
                <button class="btn-secondary" onclick="testDevice('${device.id}')">
                    <i class="fas fa-vial"></i> Testar
                </button>
                <button class="btn-secondary" onclick="editDevice('${device.id}')">
                    <i class="fas fa-edit"></i> Editar
                </button>
                <button class="btn-danger" onclick="removeDevice('${device.id}')">
                    <i class="fas fa-trash"></i> Remover
                </button>
            </div>
        </div>
    `;
}

// Create motor item HTML
function createMotorItem(device, motorNum) {
    const motor = device.motors?.[motorNum - 1] || {};
    const isActive = motor.active || false;
    const petId = motor.petId || '';
    const level = motor.level || 0;

    return `
        <div class="motor-item">
            <div class="motor-header">
                <span class="motor-number">Motor ${motorNum}</span>
                <label class="switch">
                    <input type="checkbox" ${isActive ? 'checked' : ''}
                           onchange="toggleMotor(this, '${device.id}', ${motorNum})">
                    <span class="slider"></span>
                </label>
            </div>
            <div class="motor-config ${isActive ? '' : 'disabled'}">
                <div class="form-group-inline">
                    <label>Pet:</label>
                    <select class="motor-pet-select" ${isActive ? '' : 'disabled'}
                            onchange="updateMotorPet('${device.id}', ${motorNum}, this.value)">
                        <option value="">Nenhum</option>
                        <option value="1" ${petId === '1' ? 'selected' : ''}>Felix</option>
                        <option value="2" ${petId === '2' ? 'selected' : ''}>Luna</option>
                        <option value="3" ${petId === '3' ? 'selected' : ''}>Max</option>
                    </select>
                </div>
                <div class="form-group-inline">
                    <label>Nível de Ração:</label>
                    <div class="level-indicator">
                        <div class="level-bar" style="width: ${level}%"></div>
                        <span>${isActive ? level + '%' : '--'}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Toggle motor on/off
function toggleMotor(checkbox, deviceId, motorNum) {
    const device = devices.find(d => d.id === deviceId);
    if (!device) return;

    if (!device.motors) device.motors = [{}, {}, {}];
    device.motors[motorNum - 1].active = checkbox.checked;

    saveDevices();
    renderDevices();

    // Send command to device via WebSocket
    sendWebSocketMessage({
        action: 'updateMotor',
        deviceId: deviceId,
        motorIndex: motorNum - 1,
        active: checkbox.checked
    });

    showNotification('Motor Atualizado',
        `Motor ${motorNum} ${checkbox.checked ? 'ativado' : 'desativado'}`,
        'success');
}

// Update motor pet association
function updateMotorPet(deviceId, motorNum, petId) {
    const device = devices.find(d => d.id === deviceId);
    if (!device) return;

    if (!device.motors) device.motors = [{}, {}, {}];
    device.motors[motorNum - 1].petId = petId;

    saveDevices();

    // Send command to device
    sendWebSocketMessage({
        action: 'updateMotor',
        deviceId: deviceId,
        motorIndex: motorNum - 1,
        petId: petId
    });

    const petName = petId === '1' ? 'Felix' : petId === '2' ? 'Luna' : petId === '3' ? 'Max' : 'nenhum';
    showNotification('Associação Atualizada',
        `Motor ${motorNum} associado a ${petName}`,
        'success');
}

// Add new device
function addNewDevice() {
    const deviceId = prompt('Digite o Device ID do ESP32 (ex: PF_AABBCC001122):');
    if (!deviceId) return;

    const deviceName = prompt('Digite um nome para este dispositivo:');

    const newDevice = {
        id: deviceId.trim(),
        name: deviceName || 'ESP32 - ' + deviceId.substring(3, 9),
        online: false,
        ip: '',
        rssi: '',
        uptime: '',
        motors: [
            { active: false, petId: '', level: 0 },
            { active: false, petId: '', level: 0 },
            { active: false, petId: '', level: 0 }
        ]
    };

    devices.push(newDevice);
    saveDevices();
    renderDevices();

    // Register device on server
    sendWebSocketMessage({
        action: 'registerDevice',
        device: newDevice
    });

    showNotification('Dispositivo Adicionado',
        `${newDevice.name} foi adicionado com sucesso!`,
        'success');
}

// Edit device
function editDevice(deviceId) {
    const device = devices.find(d => d.id === deviceId);
    if (!device) return;

    const newName = prompt('Novo nome do dispositivo:', device.name);
    if (newName) {
        device.name = newName;
        saveDevices();
        renderDevices();
        showNotification('Dispositivo Atualizado', 'Nome atualizado com sucesso!', 'success');
    }
}

// Remove device
function removeDevice(deviceId) {
    if (!confirm('Tem certeza que deseja remover este dispositivo?')) return;

    devices = devices.filter(d => d.id !== deviceId);
    saveDevices();
    renderDevices();

    // Unregister device on server
    sendWebSocketMessage({
        action: 'unregisterDevice',
        deviceId: deviceId
    });

    showNotification('Dispositivo Removido', 'Dispositivo removido com sucesso!', 'success');
}

// Calibrate device
function calibrateDevice(deviceId) {
    const steps = prompt('Digite o número de steps para calibração (padrão: 2048):');
    if (!steps) return;

    sendWebSocketMessage({
        action: 'calibrate',
        deviceId: deviceId,
        steps: parseInt(steps)
    });

    showNotification('Calibração Iniciada',
        'O motor irá girar ' + steps + ' steps para calibração',
        'info');
}

// Test device
function testDevice(deviceId) {
    const motor = prompt('Qual motor testar? (1, 2 ou 3):');
    if (!motor || !['1', '2', '3'].includes(motor)) return;

    sendWebSocketMessage({
        action: 'test',
        deviceId: deviceId,
        motorIndex: parseInt(motor) - 1,
        amount: 10 // Test with 10g
    });

    showNotification('Teste Iniciado',
        `Motor ${motor} irá dispensar 10g para teste`,
        'info');
}

// Save devices to localStorage
function saveDevices() {
    localStorage.setItem('petfeeder_devices', JSON.stringify(devices));
}

// Update device list with pet names in selects
function updateDeviceSelectsInPetForms() {
    ['pet1', 'pet2', 'pet3'].forEach(petId => {
        const select = document.getElementById(`${petId}-device`);
        if (!select) return;

        select.innerHTML = '<option value="">Selecione...</option>';
        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.id;
            option.textContent = device.name;
            select.appendChild(option);
        });
    });
}

// Modified feedPet function to use portion sizes
const originalFeedPet = window.feedPet;
window.feedPet = function(petId) {
    const amount = getPortionAmount(`pet${petId}`);

    // Find which device and motor is associated with this pet
    const deviceForPet = devices.find(d =>
        d.motors?.some(m => m.active && m.petId === petId.toString())
    );

    if (!deviceForPet) {
        showNotification('Erro',
            'Nenhum dispositivo configurado para este pet. Configure na aba Dispositivos.',
            'error');
        return;
    }

    const motorIndex = deviceForPet.motors.findIndex(m =>
        m.active && m.petId === petId.toString()
    );

    sendWebSocketMessage({
        action: 'feed',
        deviceId: deviceForPet.id,
        motorIndex: motorIndex,
        petId: petId,
        amount: amount
    });

    const portionType = document.getElementById(`pet${petId}-portion`).value;
    const portionLabel = portionType === 'small' ? 'Pequena' :
                        portionType === 'medium' ? 'Média' :
                        portionType === 'large' ? 'Grande' : 'Personalizada';

    // Add to history
    addToHistory(petId, amount, 'manual', true);

    // Update pet card last feed time
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const lastFeedEl = document.getElementById(`pet${petId}-last-feed`);
    if (lastFeedEl) lastFeedEl.textContent = timeStr;

    // Update today's amount
    const todayEl = document.getElementById(`pet${petId}-today`);
    if (todayEl) {
        const current = parseFloat(todayEl.textContent) || 0;
        todayEl.textContent = (current + amount) + 'g';
    }

    showNotification('Alimentação Iniciada',
        `Dispensando porção ${portionLabel} (${amount}g)`,
        'success');
};

// Initialize on page load (devices specific)
document.addEventListener('DOMContentLoaded', function() {
    initPortionHandlers();
    loadDevices();
    updateDeviceSelectsInPetForms();
    loadMotorCalibration();
});

// Update device status from WebSocket
function updateDeviceStatus(data) {
    if (data.type === 'device_status') {
        const device = devices.find(d => d.id === data.deviceId);
        if (device) {
            device.online = data.online;
            device.ip = data.ip;
            device.rssi = data.rssi;
            device.uptime = data.uptime;

            if (data.motors) {
                device.motors = device.motors || [{}, {}, {}];
                data.motors.forEach((motor, index) => {
                    if (device.motors[index]) {
                        device.motors[index].level = motor.level || 0;
                    }
                });
            }

            saveDevices();
            renderDevices();
        }
    } else if (data.type === 'devices_list') {
        // Merge server devices with local devices
        data.devices.forEach(serverDevice => {
            const localDevice = devices.find(d => d.id === serverDevice.id);
            if (localDevice) {
                Object.assign(localDevice, serverDevice);
            } else {
                devices.push(serverDevice);
            }
        });
        saveDevices();
        renderDevices();
        updateDeviceSelectsInPetForms();
    }
}

// Extend WebSocket message handler
const originalHandleWebSocketMessage = handleWebSocketMessage;
handleWebSocketMessage = function(data) {
    originalHandleWebSocketMessage(data);
    updateDeviceStatus(data);
};

// =============== INITIALIZATION COMPLETE ===============
console.log('PetFeeder Pro Interface Loaded Successfully!');

// =============== DARK MODE ===============
// Theme management
function initTheme() {
    const savedTheme = localStorage.getItem('petfeeder_theme') || 'light';
    const themeToggle = document.getElementById('theme-toggle');
    
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        updateThemeIcon(true);
    }
    
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
}

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('petfeeder_theme', isDark ? 'dark' : 'light');
    updateThemeIcon(isDark);
    
    // Redraw charts with new theme
    setupConsumptionChart();
}

function updateThemeIcon(isDark) {
    const icon = document.querySelector('#theme-toggle i');
    if (icon) {
        icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    }
}

// Initialize theme on load
document.addEventListener('DOMContentLoaded', function() {
    initTheme();
});
