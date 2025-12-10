// API Client for PetFeeder Backend
class APIClient {
  constructor(baseURL) {
    this.baseURL = baseURL;
    this.accessToken = localStorage.getItem(CONFIG.STORAGE_KEYS.ACCESS_TOKEN);
    this.refreshToken = localStorage.getItem(CONFIG.STORAGE_KEYS.REFRESH_TOKEN);
  }

  // Get authorization header
  getAuthHeader() {
    if (this.accessToken) {
      return { Authorization: `Bearer ${this.accessToken}` };
    }
    return {};
  }

  // Make HTTP request
  async request(method, endpoint, data = null, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...this.getAuthHeader(),
      ...options.headers,
    };

    const config = {
      method,
      headers,
      ...options,
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      config.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url, config);
      const result = await response.json();

      if (!response.ok) {
        // Token expired, try to refresh
        if (response.status === 401 && this.refreshToken) {
          const refreshed = await this.refreshAccessToken();
          if (refreshed) {
            // Retry request with new token
            return this.request(method, endpoint, data, options);
          }
        }

        throw new Error(result.message || 'Request failed');
      }

      return result;
    } catch (error) {
      console.error('API Request Error:', error);
      throw error;
    }
  }

  // Refresh access token
  async refreshAccessToken() {
    try {
      const response = await fetch(`${this.baseURL}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refreshToken: this.refreshToken,
        }),
      });

      const result = await response.json();

      if (result.success) {
        this.accessToken = result.data.accessToken;
        localStorage.setItem(CONFIG.STORAGE_KEYS.ACCESS_TOKEN, this.accessToken);
        return true;
      }

      // Refresh failed, logout
      this.logout();
      return false;
    } catch (error) {
      console.error('Token refresh error:', error);
      this.logout();
      return false;
    }
  }

  // Logout (clear tokens)
  logout() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem(CONFIG.STORAGE_KEYS.ACCESS_TOKEN);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.REFRESH_TOKEN);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.USER_DATA);
    window.location.href = '/login.html';
  }

  // ====================
  // AUTH ENDPOINTS
  // ====================

  async login(email, password, totpToken = null) {
    const result = await this.request('POST', '/auth/login', {
      email,
      password,
      totpToken,
    });

    if (result.success) {
      this.accessToken = result.data.accessToken;
      this.refreshToken = result.data.refreshToken;
      localStorage.setItem(CONFIG.STORAGE_KEYS.ACCESS_TOKEN, this.accessToken);
      localStorage.setItem(CONFIG.STORAGE_KEYS.REFRESH_TOKEN, this.refreshToken);
      localStorage.setItem(CONFIG.STORAGE_KEYS.USER_DATA, JSON.stringify(result.data.user));
    }

    return result;
  }

  async register(email, password, name, timezone) {
    const result = await this.request('POST', '/auth/register', {
      email,
      password,
      name,
      timezone,
    });

    // Save tokens after successful registration (auto-login)
    if (result.success && result.data) {
      this.accessToken = result.data.accessToken;
      this.refreshToken = result.data.refreshToken;
      localStorage.setItem(CONFIG.STORAGE_KEYS.ACCESS_TOKEN, this.accessToken);
      localStorage.setItem(CONFIG.STORAGE_KEYS.REFRESH_TOKEN, this.refreshToken);
      if (result.data.user) {
        localStorage.setItem(CONFIG.STORAGE_KEYS.USER_DATA, JSON.stringify(result.data.user));
      }
    }

    return result;
  }

  async getMe() {
    return this.request('GET', '/auth/me');
  }

  async getDeviceToken() {
    return this.request('GET', '/auth/device-token');
  }

  async logoutAPI() {
    const result = await this.request('POST', '/auth/logout');
    this.logout();
    return result;
  }

  // ====================
  // DEVICES ENDPOINTS
  // ====================

  async getDevices() {
    return this.request('GET', '/devices');
  }

  async getDevice(id) {
    return this.request('GET', `/devices/${id}`);
  }

  async linkDevice(deviceId, name) {
    return this.request('POST', '/devices/link', { deviceId, name });
  }

  async updateDevice(id, data) {
    return this.request('PUT', `/devices/${id}`, data);
  }

  async deleteDevice(id) {
    return this.request('DELETE', `/devices/${id}`);
  }

  async sendCommand(deviceId, command, data = {}) {
    return this.request('POST', `/devices/${deviceId}/command`, { command, data });
  }

  async getTelemetry(deviceId, limit = 100) {
    return this.request('GET', `/devices/${deviceId}/telemetry?limit=${limit}`);
  }

  async restartDevice(deviceId) {
    return this.request('POST', `/devices/${deviceId}/restart`);
  }

  async updateDevicePowerSave(deviceId, enabled) {
    return this.request('PUT', `/devices/${deviceId}/power-save`, { enabled });
  }

  // ====================
  // PETS ENDPOINTS
  // ====================

  async getPets() {
    return this.request('GET', '/pets');
  }

  async getPet(id) {
    return this.request('GET', `/pets/${id}`);
  }

  async createPet(data) {
    return this.request('POST', '/pets', data);
  }

  async updatePet(id, data) {
    return this.request('PUT', `/pets/${id}`, data);
  }

  async deletePet(id) {
    return this.request('DELETE', `/pets/${id}`);
  }

  async getPetStatistics(id, days = 30) {
    return this.request('GET', `/pets/${id}/statistics?days=${days}`);
  }

  // ====================
  // FEED ENDPOINTS
  // ====================

  async feedNow(deviceId, petId, amount) {
    return this.request('POST', '/feed/now', {
      deviceId: deviceId,
      petId: petId,
      amount,
    });
  }

  async getHistory(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.request('GET', `/feed/history?${queryString}`);
  }

  async getStatistics(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.request('GET', `/feed/statistics?${queryString}`);
  }

  async getSchedules(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.request('GET', `/schedules?${queryString}`);
  }

  async createSchedule(data) {
    return this.request('POST', '/schedules', data);
  }

  async updateSchedule(id, data) {
    return this.request('PUT', `/schedules/${id}`, data);
  }

  async deleteSchedule(id) {
    return this.request('DELETE', `/schedules/${id}`);
  }
}

// Create global API instance
const api = new APIClient(CONFIG.API_URL);
