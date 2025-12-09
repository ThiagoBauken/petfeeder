-- PetFeeder SaaS PostgreSQL Schema
-- Version: 1.0.0

-- ==================== EXTENSIONS ====================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- Para busca de texto
CREATE EXTENSION IF NOT EXISTS "btree_gin"; -- Para índices compostos

-- ==================== ENUMS ====================
CREATE TYPE user_plan AS ENUM ('free', 'basic', 'premium', 'enterprise');
CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'deleted');
CREATE TYPE device_status AS ENUM ('online', 'offline', 'maintenance', 'error');
CREATE TYPE pet_type AS ENUM ('cat', 'dog', 'other');
CREATE TYPE feeding_trigger AS ENUM ('scheduled', 'manual', 'app', 'button', 'voice', 'api', 'presence');
CREATE TYPE feeding_status AS ENUM ('pending', 'dispensing', 'completed', 'failed', 'cancelled');
CREATE TYPE alert_type AS ENUM ('low_food', 'offline', 'error', 'maintenance', 'info', 'warning');
CREATE TYPE alert_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded');

-- ==================== TABLES ====================

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    
    -- Profile
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    avatar_url TEXT,
    
    -- Plan & Billing
    plan user_plan DEFAULT 'free',
    plan_expires_at TIMESTAMP,
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    
    -- Verification
    email_verified BOOLEAN DEFAULT false,
    email_verification_token VARCHAR(255),
    email_verified_at TIMESTAMP,
    
    -- Password Reset
    reset_password_token VARCHAR(255),
    reset_password_expires TIMESTAMP,
    
    -- 2FA
    two_factor_enabled BOOLEAN DEFAULT false,
    two_factor_secret VARCHAR(255),
    
    -- Preferences
    timezone VARCHAR(50) DEFAULT 'America/Sao_Paulo',
    language VARCHAR(10) DEFAULT 'pt-BR',
    currency VARCHAR(3) DEFAULT 'BRL',
    
    -- Notifications
    notifications_email BOOLEAN DEFAULT true,
    notifications_push BOOLEAN DEFAULT true,
    notifications_sms BOOLEAN DEFAULT false,
    
    -- External
    telegram_chat_id VARCHAR(255),
    google_id VARCHAR(255),
    facebook_id VARCHAR(255),
    
    -- Metadata
    status user_status DEFAULT 'active',
    last_login_at TIMESTAMP,
    last_login_ip INET,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    
    -- Indexes
    INDEX idx_users_email (email),
    INDEX idx_users_status (status),
    INDEX idx_users_plan (plan)
);

-- Devices table
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(50) UNIQUE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    
    -- Info
    name VARCHAR(255) DEFAULT 'Meu Alimentador',
    location VARCHAR(255),
    notes TEXT,
    
    -- Technical
    device_type VARCHAR(50) DEFAULT 'PETFEEDER_V1',
    firmware_version VARCHAR(20),
    hardware_version VARCHAR(20),
    mac_address VARCHAR(17),
    
    -- Status
    status device_status DEFAULT 'offline',
    last_seen_at TIMESTAMP,
    ip_address INET,
    rssi INTEGER,
    battery_level INTEGER,
    uptime_seconds BIGINT,
    
    -- Credentials
    auth_token VARCHAR(255) UNIQUE,
    mqtt_username VARCHAR(255),
    mqtt_password VARCHAR(255),
    api_key VARCHAR(255),
    
    -- Settings
    timezone_offset INTEGER DEFAULT -3,
    steps_per_gram DECIMAL(10,2) DEFAULT 41.0,
    motor_speed INTEGER DEFAULT 2,
    sound_enabled BOOLEAN DEFAULT true,
    led_enabled BOOLEAN DEFAULT true,
    
    -- Capabilities
    motors_count INTEGER DEFAULT 3,
    sensors_count INTEGER DEFAULT 3,
    has_camera BOOLEAN DEFAULT false,
    has_rtc BOOLEAN DEFAULT true,
    has_ota BOOLEAN DEFAULT true,
    has_wifi BOOLEAN DEFAULT true,
    has_bluetooth BOOLEAN DEFAULT false,
    
    -- Metadata
    activated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_devices_user_id (user_id),
    INDEX idx_devices_device_id (device_id),
    INDEX idx_devices_status (status)
);

-- Pets table
CREATE TABLE pets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(50) REFERENCES devices(device_id),
    
    -- Profile
    name VARCHAR(255) NOT NULL,
    type pet_type DEFAULT 'cat',
    breed VARCHAR(100),
    color VARCHAR(50),
    microchip VARCHAR(50),
    
    -- Details
    birth_date DATE,
    weight_kg DECIMAL(5,2),
    photo_url TEXT,
    
    -- Feeding
    daily_amount_grams DECIMAL(6,2) DEFAULT 60.0,
    meals_per_day INTEGER DEFAULT 3,
    portion_size_grams DECIMAL(6,2) DEFAULT 20.0,
    compartment INTEGER CHECK (compartment >= 1 AND compartment <= 3),
    
    -- Medical
    health_notes TEXT,
    veterinarian VARCHAR(255),
    medications TEXT,
    allergies TEXT,
    
    -- Status
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_pets_user_id (user_id),
    INDEX idx_pets_device_id (device_id)
);

-- Schedules table
CREATE TABLE schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(50) REFERENCES devices(device_id),
    pet_id UUID REFERENCES pets(id) ON DELETE CASCADE,
    
    -- Schedule
    name VARCHAR(255),
    hour INTEGER NOT NULL CHECK (hour >= 0 AND hour <= 23),
    minute INTEGER NOT NULL CHECK (minute >= 0 AND minute <= 59),
    amount_grams DECIMAL(6,2) NOT NULL,
    
    -- Days
    monday BOOLEAN DEFAULT true,
    tuesday BOOLEAN DEFAULT true,
    wednesday BOOLEAN DEFAULT true,
    thursday BOOLEAN DEFAULT true,
    friday BOOLEAN DEFAULT true,
    saturday BOOLEAN DEFAULT true,
    sunday BOOLEAN DEFAULT true,
    
    -- Config
    active BOOLEAN DEFAULT true,
    start_date DATE,
    end_date DATE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_schedules_user_id (user_id),
    INDEX idx_schedules_device_id (device_id),
    INDEX idx_schedules_time (hour, minute)
);

-- Feedings log table
CREATE TABLE feedings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(50) REFERENCES devices(device_id),
    pet_id UUID REFERENCES pets(id) ON DELETE SET NULL,
    schedule_id UUID REFERENCES schedules(id) ON DELETE SET NULL,
    
    -- Feeding data
    amount_grams DECIMAL(6,2) NOT NULL,
    trigger feeding_trigger DEFAULT 'manual',
    status feeding_status DEFAULT 'completed',
    
    -- Metrics
    duration_seconds INTEGER,
    motor_steps INTEGER,
    food_level_before DECIMAL(5,2),
    food_level_after DECIMAL(5,2),
    
    -- Error handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    
    -- Metadata
    triggered_by VARCHAR(255), -- user_id, schedule, api, etc
    notes TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    
    -- Indexes
    INDEX idx_feedings_user_id (user_id),
    INDEX idx_feedings_device_id (device_id),
    INDEX idx_feedings_pet_id (pet_id),
    INDEX idx_feedings_created_at (created_at DESC)
);

-- Alerts table
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(50) REFERENCES devices(device_id) ON DELETE CASCADE,
    
    -- Alert data
    type alert_type NOT NULL,
    severity alert_severity DEFAULT 'medium',
    title VARCHAR(255),
    message TEXT NOT NULL,
    data JSONB,
    
    -- Status
    read BOOLEAN DEFAULT false,
    resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMP,
    resolved_by UUID REFERENCES users(id),
    
    -- Notifications sent
    email_sent BOOLEAN DEFAULT false,
    push_sent BOOLEAN DEFAULT false,
    sms_sent BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_alerts_user_id (user_id),
    INDEX idx_alerts_device_id (device_id),
    INDEX idx_alerts_type (type),
    INDEX idx_alerts_created_at (created_at DESC)
);

-- Telemetry table (time-series data)
CREATE TABLE telemetry (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(50) REFERENCES devices(device_id) ON DELETE CASCADE,
    
    -- Sensor data
    food_level_1 DECIMAL(5,2),
    food_level_2 DECIMAL(5,2),
    food_level_3 DECIMAL(5,2),
    
    -- Environment
    temperature DECIMAL(5,2),
    humidity DECIMAL(5,2),
    
    -- Device metrics
    battery_level INTEGER,
    rssi INTEGER,
    free_heap INTEGER,
    uptime_seconds BIGINT,
    
    -- Motor status
    motor_1_running BOOLEAN DEFAULT false,
    motor_2_running BOOLEAN DEFAULT false,
    motor_3_running BOOLEAN DEFAULT false,
    
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_telemetry_device_timestamp (device_id, timestamp DESC)
) PARTITION BY RANGE (timestamp);

-- Create monthly partitions for telemetry
CREATE TABLE telemetry_2024_01 PARTITION OF telemetry
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE telemetry_2024_02 PARTITION OF telemetry
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

-- Continue for all months...

-- Commands table (for device commands)
CREATE TABLE commands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(50) REFERENCES devices(device_id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    
    -- Command
    command VARCHAR(50) NOT NULL,
    parameters JSONB,
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending', -- pending, sent, acknowledged, completed, failed
    
    -- Response
    response JSONB,
    error_message TEXT,
    
    -- Timing
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP,
    acknowledged_at TIMESTAMP,
    completed_at TIMESTAMP,
    expires_at TIMESTAMP,
    
    -- Indexes
    INDEX idx_commands_device_id (device_id),
    INDEX idx_commands_status (status),
    INDEX idx_commands_created_at (created_at DESC)
);

-- Payments table
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    
    -- Stripe
    stripe_payment_intent_id VARCHAR(255),
    stripe_invoice_id VARCHAR(255),
    
    -- Payment details
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'BRL',
    description TEXT,
    
    -- Status
    status payment_status DEFAULT 'pending',
    
    -- Metadata
    metadata JSONB,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP,
    
    -- Indexes
    INDEX idx_payments_user_id (user_id),
    INDEX idx_payments_status (status)
);

-- API Keys table
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(255) UNIQUE NOT NULL,
    prefix VARCHAR(10) NOT NULL, -- For identification
    
    -- Permissions
    permissions JSONB DEFAULT '["read"]',
    
    -- Limits
    rate_limit INTEGER DEFAULT 1000, -- requests per hour
    
    -- Usage
    last_used_at TIMESTAMP,
    usage_count BIGINT DEFAULT 0,
    
    -- Status
    active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_api_keys_user_id (user_id),
    INDEX idx_api_keys_prefix (prefix)
);

-- Audit Log table
CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    
    -- Action
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    
    -- Data
    old_data JSONB,
    new_data JSONB,
    
    -- Request info
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_audit_logs_user_id (user_id),
    INDEX idx_audit_logs_entity (entity_type, entity_id),
    INDEX idx_audit_logs_created_at (created_at DESC)
);

-- ==================== VIEWS ====================

-- Active devices with stats
CREATE VIEW device_stats AS
SELECT 
    d.id,
    d.device_id,
    d.user_id,
    d.name,
    d.status,
    d.last_seen_at,
    COUNT(DISTINCT p.id) as pet_count,
    COUNT(DISTINCT s.id) as schedule_count,
    COUNT(DISTINCT f.id) FILTER (WHERE f.created_at > CURRENT_DATE) as feedings_today
FROM devices d
LEFT JOIN pets p ON d.device_id = p.device_id AND p.active = true
LEFT JOIN schedules s ON d.device_id = s.device_id AND s.active = true
LEFT JOIN feedings f ON d.device_id = f.device_id
GROUP BY d.id;

-- User statistics
CREATE VIEW user_stats AS
SELECT 
    u.id,
    u.email,
    u.plan,
    COUNT(DISTINCT d.id) as device_count,
    COUNT(DISTINCT p.id) as pet_count,
    COUNT(DISTINCT s.id) as schedule_count,
    SUM(f.amount_grams) FILTER (WHERE f.created_at > CURRENT_DATE) as food_dispensed_today
FROM users u
LEFT JOIN devices d ON u.id = d.user_id
LEFT JOIN pets p ON u.id = p.user_id AND p.active = true
LEFT JOIN schedules s ON u.id = s.user_id AND s.active = true
LEFT JOIN feedings f ON u.id = f.user_id
WHERE u.status = 'active'
GROUP BY u.id;

-- ==================== FUNCTIONS ====================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_devices_updated_at BEFORE UPDATE ON devices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_pets_updated_at BEFORE UPDATE ON pets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_schedules_updated_at BEFORE UPDATE ON schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Function to check user plan limits
CREATE OR REPLACE FUNCTION check_plan_limits()
RETURNS TRIGGER AS $$
DECLARE
    device_limit INTEGER;
    current_count INTEGER;
BEGIN
    -- Get plan limits
    SELECT CASE 
        WHEN plan = 'free' THEN 1
        WHEN plan = 'basic' THEN 3
        WHEN plan = 'premium' THEN 10
        WHEN plan = 'enterprise' THEN 999
    END INTO device_limit
    FROM users WHERE id = NEW.user_id;
    
    -- Count current devices
    SELECT COUNT(*) INTO current_count
    FROM devices WHERE user_id = NEW.user_id;
    
    IF current_count >= device_limit THEN
        RAISE EXCEPTION 'Device limit exceeded for plan';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_device_limit BEFORE INSERT ON devices
    FOR EACH ROW EXECUTE FUNCTION check_plan_limits();

-- ==================== INDEXES ====================

-- Performance indexes
CREATE INDEX idx_feedings_date ON feedings(created_at) WHERE created_at > CURRENT_DATE - INTERVAL '30 days';
CREATE INDEX idx_telemetry_recent ON telemetry(device_id, timestamp) WHERE timestamp > CURRENT_DATE - INTERVAL '7 days';
CREATE INDEX idx_alerts_unread ON alerts(user_id, created_at) WHERE read = false;
CREATE INDEX idx_devices_online ON devices(user_id) WHERE status = 'online';

-- Full text search
CREATE INDEX idx_pets_name_search ON pets USING gin(name gin_trgm_ops);
CREATE INDEX idx_devices_name_search ON devices USING gin(name gin_trgm_ops);

-- ==================== INITIAL DATA ====================

-- Insert default admin user
INSERT INTO users (email, password_hash, name, plan, email_verified)
VALUES ('admin@petfeeder.com', '$2b$10$...', 'Admin', 'enterprise', true);

-- ==================== PERMISSIONS ====================

-- Create read-only user for analytics
CREATE USER analytics_user WITH PASSWORD 'analytics_password';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analytics_user;

-- Create application user
CREATE USER app_user WITH PASSWORD 'app_password';
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_user;
