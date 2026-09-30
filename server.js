const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_PRjNZlQ51yqx@ep-silent-credit-b7l751ny-pooler.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false } 
});

// 1. SYNC WASTE DATA
app.post('/api/sync', async (req, res) => {
  try {
    const wasteData = req.body;
    const records = Array.isArray(wasteData) ? wasteData : [wasteData];

    for (let row of records) {
      await pool.query(
        `INSERT INTO waste_logs (day, time, shift, category, item, quantity, unit_cost, total_cost, reason, staff)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [row.Date, row.Time, row.Shift, row.Category, row.Item, row.Quantity, row.Cost, row.Total, row.Reason || '', row.LoggedBy]
      );
    }
    res.status(200).json({ message: 'Data synced successfully to Neon!' });
  } catch (error) {
    console.error("Database insert error:", error);
    res.status(500).json({ error: 'Server error while inserting data' });
  }
});

// 2. FETCH ALL USERS (For Manager Setup Menu)
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, username, is_manager, fields FROM users ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// 3. REGISTER NEW USER
app.post('/api/users/register', async (req, res) => {
  const { name, username, password, is_manager, fields } = req.body;
  
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Name, username, and password are required' });
  }

  try {
    const check = await pool.query('SELECT id FROM users WHERE username = $1', [username.toLowerCase()]);
    if (check.rows.length > 0) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const query = `
      INSERT INTO users (name, username, password, is_manager, fields)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, username, is_manager, fields;
    `;
    const values = [name, username.toLowerCase(), password, is_manager || false, JSON.stringify(fields || [])];
    const result = await pool.query(query, values);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// 4. LOGIN USER
app.post('/api/users/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const query = 'SELECT id, name, username, is_manager, fields FROM users WHERE username = $1 AND password = $2';
    const result = await pool.query(query, [username.toLowerCase(), password]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// 5. GET AGGREGATED REPORT BY CATEGORY
app.get('/api/reports', async (req, res) => {
  try {
    const query = `
      SELECT category, SUM(quantity) AS items_wasted, SUM(total_cost) AS total_cost
      FROM waste_logs
      GROUP BY category
      ORDER BY total_cost DESC;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching report:', err);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

// 6. GET ALL LOGS FOR CSV EXPORT
app.get('/api/logs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM waste_logs ORDER BY id DESC;');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching logs:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Live sync server running on http://localhost:${PORT}`);
});
