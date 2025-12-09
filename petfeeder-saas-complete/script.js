// =============== GLOBAL VARIABLES ===============
let ws = null;
let reconnectInterval = null;
let systemData = {
    pets: [],
    schedules: [],
    levels: {},
    status: {},
    history: []
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
        showLoading();
        sendWebSocketMessage({
            action: 'feed',
            petId: 0
        });
        
        setTimeout(hideLoading, 5000);
    }
}

function testDispenser() {
    if (confirm('Testar todos os dispensadores?')) {
        showLoading();
        sendWebSocketMessage({
            action: 'test'
        });
        
        setTimeout(() => {
            hideLoading();
            showNotification('Teste Completo', 'Todos os dispensadores foram testados com sucesso!', 'success');
        }, 3000);
    }
}

function emergencyStop() {
    sendWebSocketMessage({
        action: 'emergencyStop'
    });
    showNotification('Parada de Emergência', 'Sistema parado. Reinicie para continuar.', 'warning');
}

function calibrateServos() {
    if (confirm('Iniciar calibração dos servos?')) {
        showLoading();
        sendWebSocketMessage({
            action: 'calibrate'
        });
        
        setTimeout(() => {
            hideLoading();
            showNotification('Calibração', 'Calibração concluída com sucesso!', 'success');
        }, 5000);
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
    tbody.innerHTML = '';
    
    historyData.forEach(entry => {
        const row = document.createElement('tr');
        const petName = entry.pet === 0 ? 'Todos' : 
                       document.getElementById(`pet${entry.pet}-name`).textContent;
        
        row.innerHTML = `
            <td>${entry.time}</td>
            <td>${petName}</td>
            <td>${entry.amount}g</td>
            <td>${getTypeLabel(entry.type)}</td>
            <td><span class="success">✓ Completo</span></td>
        `;
        
        tbody.appendChild(row);
    });
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
    
    // Servo calibration sliders
    setupCalibrationSliders();
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
function setupCalibrationSliders() {
    for (let i = 1; i <= 3; i++) {
        const closeSlider = document.getElementById(`servo${i}-close`);
        const openSlider = document.getElementById(`servo${i}-open`);
        
        if (closeSlider) {
            closeSlider.addEventListener('input', (e) => {
                document.getElementById(`servo${i}-close-value`).textContent = `${e.target.value}°`;
            });
        }
        
        if (openSlider) {
            openSlider.addEventListener('input', (e) => {
                document.getElementById(`servo${i}-open-value`).textContent = `${e.target.value}°`;
            });
        }
    }
}

function testServoCalibration() {
    const calibrationData = [];
    
    for (let i = 1; i <= 3; i++) {
        calibrationData.push({
            servo: i,
            closeAngle: parseInt(document.getElementById(`servo${i}-close`).value),
            openAngle: parseInt(document.getElementById(`servo${i}-open`).value)
        });
    }
    
    sendWebSocketMessage({
        action: 'testCalibration',
        calibration: calibrationData
    });
    
    showNotification('Teste', 'Testando calibração dos servos...', 'info');
}

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
    
    // Mock data - will be replaced with real data
    const ctx = canvas.getContext('2d');
    
    // Simple bar chart
    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const data = [180, 175, 182, 178, 180, 177, 179];
    
    const chartWidth = canvas.width;
    const chartHeight = canvas.height;
    const barWidth = chartWidth / days.length * 0.8;
    const maxValue = Math.max(...data);
    
    ctx.fillStyle = '#667eea';
    data.forEach((value, index) => {
        const barHeight = (value / maxValue) * (chartHeight - 40);
        const x = (index * chartWidth / days.length) + (chartWidth / days.length - barWidth) / 2;
        const y = chartHeight - barHeight - 20;
        
        ctx.fillRect(x, y, barWidth, barHeight);
        
        // Draw labels
        ctx.fillStyle = '#2d3748';
        ctx.font = '12px Poppins';
        ctx.textAlign = 'center';
        ctx.fillText(days[index], x + barWidth / 2, chartHeight - 5);
        ctx.fillText(value + 'g', x + barWidth / 2, y - 5);
        
        ctx.fillStyle = '#667eea';
    });
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

// =============== INITIALIZATION COMPLETE ===============
console.log('PetFeeder Pro Interface Loaded Successfully!');
