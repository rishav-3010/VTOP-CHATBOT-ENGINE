const { Pool } = require('pg');

// Create a connection pool using the connection string from environment variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialize Tables
const initDB = async () => {
    if (!process.env.DATABASE_URL) {
        console.warn("⚠️ DATABASE_URL not found. Database logging will be disabled.");
        return;
    }

    try {
        const client = await pool.connect();
        try {
            // 1. Users Table (Primary Key: auth_id)
            await client.query(`
                CREATE TABLE IF NOT EXISTS users (
                    auth_id VARCHAR(50) PRIMARY KEY,
                    first_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // 2. Login Logs Table (History of sessions)
            await client.query(`
                CREATE TABLE IF NOT EXISTS login_logs (
                    id SERIAL PRIMARY KEY,
                    auth_id VARCHAR(50) REFERENCES users(auth_id),
                    session_id VARCHAR(100),
                    campus VARCHAR(20),
                    login_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            `);
             
            // Add campus column if it doesn't exist (for existing tables)
            await client.query(`
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='login_logs' AND column_name='campus') THEN 
                        ALTER TABLE login_logs ADD COLUMN campus VARCHAR(20); 
                    END IF; 
                END $$;
            `);
            
            console.log('✅ Connected to Neon DB & Tables initialized.');
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('❌ Database connection failed:', err.message);
    }
};

// Function to log a login event
const logUserLogin = async (authId, sessionId, campus = 'vellore') => {
    if (!process.env.DATABASE_URL || !authId) return;

    try {
        // 1. Ensure user exists (Upsert)
        await pool.query(`
            INSERT INTO users (auth_id, last_seen)
            VALUES ($1, CURRENT_TIMESTAMP)
            ON CONFLICT (auth_id) 
            DO UPDATE SET last_seen = CURRENT_TIMESTAMP;
        `, [authId]);

        // 2. Log the specific session event
        await pool.query(`
            INSERT INTO login_logs (auth_id, session_id, campus)
            VALUES ($1, $2, $3);
        `, [authId, sessionId, campus]);

        console.log(`📝 DB: Logged login for ${authId} (Session: ${sessionId}, Campus: ${campus})`);
    } catch (err) {
        console.error('❌ DB Logging failed:', err.message);
    }
};

module.exports = { initDB, logUserLogin };
