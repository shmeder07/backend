const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

// Allow your HTML file to communicate with this script
app.use(cors()); 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect to your live database
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_PRjNZlQ51yqx@ep-silent-credit-b7l751ny-pooler.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false } // Required for cloud databases like Neon/Supabase
});

// The endpoint that replaces your Google Apps Script URL
// The endpoint that replaces your Google Apps Script URL
app.post('/api/sync', async (req, res) => {
  try {
    const wasteData = req.body;
    console.log("Received data from app:", wasteData);

    // Ensure we are dealing with an array of items
    const records = Array.isArray(wasteData) ? wasteData : [wasteData];

    for (let row of records) {
      await pool.query(
        `INSERT INTO waste_logs (day, time, shift, category, item, quantity, unit_cost, total_cost, reason, staff)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          row.Date,
          row.Time,
          row.Shift,
          row.Category,
          row.Item,
          row.Quantity, 
          row.Cost,     
          row.Total,    
          row.Reason || '',
          row.LoggedBy  
        ]
      );
    }

    res.status(200).json({ message: 'Data synced successfully to Neon!' });
  } catch (error) {
    console.error("Database insert error:", error);
    res.status(500).json({ error: 'Server error while inserting data' });
  }
});

// The endpoint to handle secure user logins against the database
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND password = $2', 
      [username, password]
    );
    
    if (result.rows.length > 0) {
      res.json({ success: true, user: result.rows[0] });
    } else {
      res.status(401).json({ success: false, error: 'Invalid username or password' });
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// The endpoint to handle new user registrations in the Neon database
app.post('/api/signup', async (req, res) => {
  try {
    const { name, username, password, is_manager } = req.body;
    
    // Check if the username already exists
    const existing = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Username already taken' });
    }
    
    // Insert the new user into the database
    const result = await pool.query(
      'INSERT INTO users (name, username, password, is_manager) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, username, password, is_manager || false]
    );
    
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET AGGREGATED REPORT BY CATEGORY
app.get('/api/reports', async (req, res) => {
  try {
    const query = `
      SELECT 
        category, 
        SUM(quantity) AS items_wasted, 
        SUM(total_cost) AS total_cost
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

// GET ALL LOGS FOR CSV EXPORT
app.get('/api/logs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM waste_logs ORDER BY id DESC;');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching logs:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// 1. FETCH ALL USERS (For Manager Setup menu)
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, username, is_manager, fields FROM users ORDER BY id ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// 2. REGISTER NEW USER
app.post('/api/users/register', async (req, res) => {
  const { name, username, password, is_manager, fields } = req.body;
  
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Name, username, and password are required' });
  }

  try {
    // Check if username already exists
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

// 3. LOGIN USER
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Live sync server running on http://localhost:${PORT}`);
});

// Fetch report data (e.g., total wasted by category)
app.get('/api/reports', async (req, res) => {
  try {
    const query = `
      SELECT category, COUNT(id) AS item_count, SUM(total) AS total_cost
      FROM waste_logs
      GROUP BY category
      ORDER BY total_cost DESC;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});
