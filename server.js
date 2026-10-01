const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

// Enable CORS and high payload limit for seeding large item arrays
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Connect to Neon PostgreSQL Database
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_PRjNZlQ51yqx@ep-silent-credit-b7l751ny-pooler.c-13.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false }
});

/* ==========================================================================
   1. ITEMS MANAGEMENT ENDPOINTS (Neon Database)
   ========================================================================== */

// GET ALL ITEMS FROM NEON
app.get('/api/items', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, category, name, unit_cost FROM items ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching items from Neon:', err);
    res.status(500).json({ error: 'Failed to fetch items from database' });
  }
});

// ONE-TIME SEEDER ENDPOINT (Populates Neon `items` table from payload)
app.post('/api/seed-items', async (req, res) => {
  const { customItems } = req.body;
  if (!customItems) return res.status(400).json({ error: 'No items payload provided' });

  try {
    // Clear existing items to prevent duplicates
    await pool.query('TRUNCATE TABLE items RESTART IDENTITY;');

    for (const [category, itemArray] of Object.entries(customItems)) {
      for (const [name, cost] of itemArray) {
        await pool.query(
          'INSERT INTO items (category, name, unit_cost) VALUES ($1, $2, $3)',
          [category, name, parseFloat(cost) || 0.00]
        );
      }
    }
    res.json({ success: true, message: 'All items successfully seeded into Neon database!' });
  } catch (err) {
    console.error('Error seeding items into Neon:', err);
    res.status(500).json({ error: 'Failed to seed items into database' });
  }
});

/* ==========================================================================
   2. WASTE LOGS ENDPOINTS
   ========================================================================== */

// GET ALL LOGS FOR APP & CSV EXPORT
app.get('/api/logs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM waste_logs ORDER BY id DESC;');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching logs:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// SAVE NEW WASTE LOG(S) TO NEON
app.post('/api/sync', async (req, res) => {
  try {
    const wasteData = req.body;
    const records = Array.isArray(wasteData) ? wasteData : [wasteData];

    for (let row of records) {
      await pool.query(
        `INSERT INTO waste_logs (day, time, shift, category, item_name, quantity, unit_cost, total_cost, reason, logged_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          row.day || new Date().toISOString().slice(0, 10),
          row.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          row.shift || 'AM',
          row.category,
          row.item_name || row.item,
          row.quantity || row.qty || 1,
          row.unit_cost || row.cost || 0,
          row.total_cost || row.total || 0,
          row.reason || '',
          row.logged_by || row.staff || 'Unknown'
        ]
      );
    }
    res.status(200).json({ message: 'Data synced successfully to Neon!' });
  } catch (error) {
    console.error("Database insert error:", error);
    res.status(500).json({ error: 'Server error while inserting data' });
  }
});

// DELETE A LOG BY ID
app.delete('/api/logs/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM waste_logs WHERE id = $1', [id]);
    res.json({ message: 'Log deleted successfully' });
  } catch (err) {
    console.error('Error deleting log:', err);
    res.status(500).json({ error: 'Failed to delete log' });
  }
});

/* ==========================================================================
   3. USER AUTHENTICATION & MANAGEMENT ENDPOINTS
   ========================================================================== */

// FETCH ALL USERS (For Manager Setup Menu)
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, username, is_manager, fields FROM users ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// REGISTER NEW USER IN NEON (Set to pending status)
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
      INSERT INTO users (name, username, password, is_manager, fields, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING id, name, username, is_manager, fields, status;
    `;
    const values = [name, username.toLowerCase(), password, Boolean(is_manager), JSON.stringify(fields || [])];
    const result = await pool.query(query, values);
      
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// LOGIN USER AGAINST NEON (Block pending accounts)
app.post('/api/users/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const query = 'SELECT id, name, username, is_manager, fields, status FROM users WHERE username = $1 AND password = $2';
    const result = await pool.query(query, [username.toLowerCase(), password]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = result.rows[0];

    // Block login if pending approval
    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Account pending manager approval. Contact Audrey.' });
    }

    res.json(user);
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// FETCH PENDING USERS (For Manager Approval Queue)
app.get('/api/users/pending', async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, username, is_manager, fields FROM users WHERE status = 'pending' ORDER BY id ASC");
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching pending users:', err);
    res.status(500).json({ error: 'Failed to fetch pending users' });
  }
});

// APPROVE PENDING USER
app.put('/api/users/approve/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("UPDATE users SET status = 'active' WHERE id = $1", [id]);
    res.json({ message: 'User approved successfully' });
  } catch (err) {
    console.error('Error approving user:', err);
    res.status(500).json({ error: 'Failed to approve user' });
  }
});

// UPDATE STAFF PERMISSIONS / FIELDS IN NEON
app.put('/api/users/update/:id', async (req, res) => {
  const { id } = req.params;
  const { is_manager, fields } = req.body;

  try {
    await pool.query(
      'UPDATE users SET is_manager = $1, fields = $2 WHERE id = $3',
      [Boolean(is_manager), JSON.stringify(fields || []), id]
    );
    res.json({ message: 'User permissions updated successfully' });
  } catch (err) {
    console.error('Error updating user permissions:', err);
    res.status(500).json({ error: 'Failed to update user permissions' });
  }
});

/* ==========================================================================
   4. AGGREGATED REPORTS ENDPOINT
   ========================================================================== */

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Live sync server running on http://localhost:${PORT}`);
});
