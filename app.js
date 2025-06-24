const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const net = require('net'); // Add this for TCP server

const app = express();
const PORT = 2025;

// Middleware
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Database connection pool
const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "Megha@9000",
  database: "client_table1",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Create TCP server
const tcpServer = net.createServer();

// Handle TCP client connections
tcpServer.on('connection', (socket) => {
  const clientAddress = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`New TCP client connected: ${clientAddress}`);
  
// Replace the data handler with this improved version

socket.on('data', async (data) => {
  try {
    // Get the raw data as string
    const rawData = data.toString().trim();
    console.log(`Raw data received from ${clientAddress}:`, rawData);
    
    let jsonData;
    
    // Check if data contains a delimiter
    if (rawData.includes('#END#')) {
      // Extract the part before the delimiter
      const beforeDelimiter = rawData.split('#END#')[0];
      console.log('Extracted part before delimiter:', beforeDelimiter);
      
      // Find the JSON part (starting from the first { character)
      const jsonStartIndex = beforeDelimiter.indexOf('{');
      if (jsonStartIndex === -1) {
        socket.write(JSON.stringify({ 
          success: false, 
          message: 'No JSON data found in the message' 
        }));
        return;
      }
      
      // Extract only the JSON part (ignoring any text before the first {)
      const jsonPart = beforeDelimiter.substring(jsonStartIndex);
      console.log('Extracted JSON part:', jsonPart);
      
      try {
        jsonData = JSON.parse(jsonPart);
      } catch (parseError) {
        console.error('Error parsing delimited JSON:', parseError);
        socket.write(JSON.stringify({ 
          success: false, 
          message: 'Invalid JSON format in the message' 
        }));
        return;
      }
    } else {
      // Try to parse the entire message as JSON
      try {
        jsonData = JSON.parse(rawData);
      } catch (parseError) {
        console.error('Error parsing JSON:', parseError);
        socket.write(JSON.stringify({ 
          success: false, 
          message: 'Expected JSON data. Please send device data in JSON format.',
          example: {
            imei: 'DEVICE_IMEI',
            device_name: 'Device Name',
            concentration: 0.0,
            alarm_level: 'normal',
            gas_level: 0.0,
            unit: 'ppm'
          }
        }));
        return;
      }
    }
    
    console.log(`Parsed data from TCP client ${clientAddress}:`, jsonData);
    
    // Handle the device field name if present instead of device_name
    if (jsonData.device && !jsonData.device_name) {
      jsonData.device_name = jsonData.device;
    }
    
    // Validate required fields
    if (!jsonData.imei || !jsonData.device_name) {
      socket.write(JSON.stringify({ 
        success: false, 
        error: 'IMEI and device_name (or device) are required',
        received: jsonData
      }));
      return;
    }
    
    // Extract the device data with better fallbacks for possibly missing fields
    const { 
      imei, 
      device_name, 
      concentration = jsonData.concentration || 0.0, 
      alarm_level = jsonData.alarm_level || 'normal', 
      gas_level = jsonData.gas_level || 0.0, 
      unit = jsonData.unit || 'ppm',
      battery = jsonData.battery || '100%',
      location = jsonData.location || '',
      gas_name = jsonData.gas_name || ''
    } = jsonData;
    
    // Check if this device is already associated with a client
    const [existingClientWithDevice] = await pool.execute(
      'SELECT id, name FROM clients WHERE device_id = ?',
      [imei]
    );
    
    let clientInfo = null;
    
    // If no client is associated with this device, create one
    if (existingClientWithDevice.length === 0) {
      // Create a new client entry with device information
      const clientName = `Client for ${device_name}`;
      const clientEmail = `device_${imei.toLowerCase()}@example.com`;
      
      const [clientResult] = await pool.execute(
        `INSERT INTO clients (name, email, status, device_id, password)
         VALUES (?, ?, 'active', ?, 'Megha@9000')`,
        [clientName, clientEmail, imei]
      );
      
      console.log(`Created new client "${clientName}" with ID ${clientResult.insertId} for device ${imei}`);
      
      clientInfo = {
        id: clientResult.insertId,
        name: clientName,
        email: clientEmail,
        device_id: imei
      };
    } else {
      clientInfo = {
        id: existingClientWithDevice[0].id,
        name: existingClientWithDevice[0].name,
        device_id: imei
      };
      console.log(`Device ${imei} is already associated with client ID ${clientInfo.id} (${clientInfo.name})`);
    }
    
    // IMPORTANT CHANGE: Always insert a new record instead of updating existing one
    await pool.execute(
      `INSERT INTO devices (imei, device_name, concentration, alarm_level, gas_level, unit, UTC, local_time) 
       VALUES (?, ?, ?, ?, ?, ?, CONVERT_TZ(NOW(), @@session.time_zone, '+00:00'), NOW())`,
      [imei, device_name, concentration, alarm_level, gas_level, unit]
    );
    
    socket.write(JSON.stringify({ 
      success: true, 
      message: 'Device data added successfully',
      device: {
        imei,
        device_name,
        concentration,
        alarm_level,
        gas_level,
        unit,
        battery,
        location,
        gas_name,
        UTC: new Date().toISOString()
      },
      client: clientInfo
    }));
  } catch (error) {
    console.error(`Error processing data from TCP client ${clientAddress}:`, error);
    socket.write(JSON.stringify({ success: false, error: error.message }));
  }
});

  socket.on('close', () => {
    console.log(`TCP client disconnected: ${clientAddress}`);
  });
  
  socket.on('error', (err) => {
    console.error(`TCP client error ${clientAddress}:`, err);
  });
});

// Start TCP server
tcpServer.listen(PORT, () => {
  console.log(`TCP server listening on port ${PORT}`);
});

// Handle errors on the server
tcpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. HTTP server will be started but TCP server failed.`);
  } else {
    console.error('TCP server error:', err);
  }
});


// Test database connection
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('Connected to MySQL database');
    connection.release();
    
    // Create client table if it doesn't exist
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS clients (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        street VARCHAR(255),
        status ENUM('active', 'inactive', 'pending') DEFAULT 'pending',
        password VARCHAR(255) DEFAULT 'Megha@9000',
        device_id VARCHAR(20) DEFAULT NULL
      )
    `);
    
 // Create device table if it doesn't exist
await pool.execute(`
  CREATE TABLE IF NOT EXISTS devices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    imei VARCHAR(20) NOT NULL,
    device_name VARCHAR(100) NOT NULL,
    concentration FLOAT DEFAULT 0.0,
    alarm_level VARCHAR(20) DEFAULT 'normal',
    gas_level FLOAT DEFAULT 0.0,
    unit VARCHAR(10) DEFAULT 'ppm',
    UTC TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    local_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (imei)
  )
`);
    
    // Update the sample data insertion

// Check if devices table has data, if not add sample data
const [deviceRows] = await pool.execute('SELECT COUNT(*) as count FROM devices');
if (deviceRows[0].count === 0) {
  // Get current time
  const now = new Date();
  
  // Insert sample devices with local time and convert to UTC

  console.log('Sample devices added to database with new parameters');
}

    // Check if password column exists, if not add it
    try {
      // First check if the column exists
      const [passwordColumns] = await pool.execute(`
        SHOW COLUMNS FROM clients LIKE 'password'
      `);
      
      // If the column doesn't exist (empty array), add it
      if (passwordColumns.length === 0) {
        await pool.execute(`
          ALTER TABLE clients
          ADD COLUMN password VARCHAR(255) DEFAULT 'Megha@9000'
        `);
        console.log('Password column added successfully');
      }
      
      // Set all existing rows to have the password Megha@9000 if they don't have one
      await pool.execute(`
        UPDATE clients
        SET password = 'Megha@9000'
        WHERE password IS NULL OR password = ''
      `);
      console.log('Existing client passwords updated to default');
      
      // Check if device_id column exists, if not add it
      const [deviceColumns] = await pool.execute(`
        SHOW COLUMNS FROM clients LIKE 'device_id'
      `);
      
      if (deviceColumns.length === 0) {
        await pool.execute(`
          ALTER TABLE clients
          ADD COLUMN device_id VARCHAR(20) DEFAULT NULL
        `);
        console.log('Device ID column added successfully');
      }
      
      // Get existing clients without device_id and assign them
      const [clients] = await pool.execute(`
        SELECT id FROM clients WHERE device_id IS NULL OR device_id = '' ORDER BY id
      `);
      
      // Define the device IDs to assign
      const deviceIds = ['MEGHA0000001', 'MEGHA0000002', 'MEGHA0000003', 
                          'MEGHA0000004', 'MEGHA0000005', 'MEGHA0000006'];
      
      // Assign device IDs to existing clients
      for (let i = 0; i < clients.length; i++) {
        const deviceId = i < deviceIds.length ? deviceIds[i] : `MEGHA${String(i+1).padStart(7, '0')}`;
        await pool.execute(`
          UPDATE clients SET device_id = ? WHERE id = ?
        `, [deviceId, clients[i].id]);
      }
      
      if (clients.length > 0) {
        console.log(`Assigned device IDs to ${clients.length} existing clients`);
      }
      
    } catch (e) {
      console.error('Error managing columns:', e.message);
    }
    
    console.log('Client table ready');
    console.log('Device table ready');
  } catch (err) {
    console.error('Could not connect to MySQL database', err);
  }
}

testConnection();

// Helper function to generate device IDs
function generateDeviceId(id) {
  return `MEGHA${String(id).padStart(7, '0')}`;
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get all clients
app.get('/api/clients', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM clients');
    
    const clients = rows.map(client => ({
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      address: {
        street: client.street
      },
      status: client.status,
      password: client.password || 'Megha@9000',
      device_id: client.device_id || generateDeviceId(client.id)
    }));
    
    res.json(clients);
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message);
  }
});

// Update the get all devices endpoint
app.get('/api/devices', async (req, res) => {
  try {
    let query = '';
    let params = [];
    
    // Check if we should group by IMEI (returning only latest entry for each device)
    if (req.query.groupByImei === 'true') {
      // For each IMEI, get only the latest record
      query = `
        SELECT d.* FROM devices d
        INNER JOIN (
          SELECT imei, MAX(local_time) as max_time
          FROM devices
          GROUP BY imei
        ) latest ON d.imei = latest.imei AND d.local_time = latest.max_time
        ORDER BY d.local_time DESC
      `;
    } else {
      // Return all device entries, ordered by timestamp
      query = `
        SELECT imei, device_name, concentration, alarm_level, gas_level, unit, UTC, local_time, id
        FROM devices
        ORDER BY local_time DESC
      `;
      
      // Add limit if specified
      if (req.query.limit) {
        query += ' LIMIT ?';
        params.push(parseInt(req.query.limit));
      }
    }
    
    const [devices] = await pool.query(query, params);
    console.log(`Retrieved ${devices.length} device records`);
    res.json(devices);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update the get device by IMEI endpoint to return multiple records
app.get('/api/devices/:imei', async (req, res) => {
  try {
    // Get all records for this IMEI, sorted by timestamp descending
    const [rows] = await pool.execute(
      'SELECT * FROM devices WHERE imei = ? ORDER BY local_time DESC',
      [req.params.imei]
    );
    
    if (rows.length === 0) return res.status(404).send('Device not found');
    
    // If the client is requesting a single record (e.g., for updates or detailed view)
    if (req.query.latest === 'true') {
      res.json(rows[0]); // Return just the latest record
    } else {
      res.json(rows); // Return all records for this IMEI
    }
  } catch (error) {
    console.error('Error fetching device:', error);
    res.status(500).send(error.message);
  }
});

// Update the API endpoints to correctly handle all the new database fields

// Add a new device
// Update the add device API endpoint
app.post('/api/devices', async (req, res) => {
  try {
    const { imei, device_name, concentration, alarm_level, gas_level, unit } = req.body;
    
    if (!imei || !device_name) {
      return res.status(400).send('IMEI and device name are required');
    }
    
    console.log('Adding new device to database:', req.body);
    
    // Always insert a new record
    const [result] = await pool.execute(
      `INSERT INTO devices (imei, device_name, concentration, alarm_level, gas_level, unit, UTC, local_time) 
       VALUES (?, ?, ?, ?, ?, ?, CONVERT_TZ(NOW(), @@session.time_zone, '+00:00'), NOW())`,
      [imei, device_name, concentration || 0.0, alarm_level || 'normal', gas_level || 0.0, unit || 'ppm']
    );
    
    // Get the newly inserted record by its ID
    const [insertedDevice] = await pool.execute(
      'SELECT * FROM devices WHERE id = ?',
      [result.insertId]
    );
    
    res.status(201).json(insertedDevice[0] || {
      imei,
      device_name,
      concentration: concentration || 0.0,
      alarm_level: alarm_level || 'normal',
      gas_level: gas_level || 0.0,
      unit: unit || 'ppm',
      UTC: new Date().toISOString(),
      local_time: new Date()
    });
  } catch (error) {
    console.error('Error adding device:', error);
    res.status(400).send(error.message);
  }
});

// Update a device
app.put('/api/devices/:imei', async (req, res) => {
  try {
    const { device_name, concentration, alarm_level, gas_level, unit } = req.body;
    const imei = req.params.imei;
    
    console.log(`Updating device ${imei} with:`, req.body);
    
    if (!imei) {
      return res.status(400).send('IMEI is required');
    }
    
    await pool.execute(
      `UPDATE devices SET 
        device_name = ?, 
        concentration = ?, 
        alarm_level = ?, 
        gas_level = ?, 
        unit = ?, 
        UTC = CONVERT_TZ(NOW(), @@session.time_zone, '+00:00'), 
        local_time = NOW() 
       WHERE imei = ?`,
      [device_name, concentration, alarm_level, gas_level, unit, imei]
    );
    
    const [rows] = await pool.execute(
      'SELECT * FROM devices WHERE imei = ?',
      [imei]
    );
    
    if (rows.length === 0) return res.status(404).send('Device not found');
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating device:', error);
    res.status(400).send(error.message);
  }
});

// Delete a device
app.delete('/api/devices/:imei', async (req, res) => {
  try {
    console.log(`Deleting device with IMEI: ${req.params.imei}`);
    
    const [result] = await pool.execute(
      'DELETE FROM devices WHERE imei = ?',
      [req.params.imei]
    );
    
    if (result.affectedRows === 0) return res.status(404).send('Device not found');
    
    res.status(200).send('Device deleted successfully');
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).send(error.message);
  }
});

// Update the get device by name endpoint to return multiple records
app.get('/api/devices/name/:deviceName', async (req, res) => {
  try {
    console.log(`Fetching device with name: ${req.params.deviceName}`);
    
    // Get all records for this device name, sorted by timestamp
    const [rows] = await pool.execute(
      'SELECT * FROM devices WHERE device_name = ? ORDER BY local_time DESC',
      [req.params.deviceName]
    );
    
    if (rows.length === 0) return res.status(404).send('Device not found');
    
    // If the client is requesting a single record
    if (req.query.latest === 'true') {
      console.log('Found latest device record:', rows[0]);
      res.json(rows[0]); // Return just the latest record
    } else {
      console.log(`Found ${rows.length} device records`);
      res.json(rows); // Return all records for this device name
    }
  } catch (error) {
    console.error('Error fetching device by name:', error);
    res.status(500).send(error.message);
  }
});

// New endpoint to get client by device_id
app.get('/api/clients/device/:deviceId', async (req, res) => {
  try {
    // First get the client with this device ID
    const [clientRows] = await pool.execute(
      'SELECT * FROM clients WHERE device_id = ?',
      [req.params.deviceId]
    );
    
    if (clientRows.length === 0) return res.status(404).send('No client associated with this device');
    
    const client = clientRows[0];
    
    // Also fetch the most recent device data (if available)
    const [deviceRows] = await pool.execute(
      'SELECT * FROM devices WHERE imei = ? OR device_name = ? ORDER BY local_time DESC LIMIT 1',
      [client.device_id, client.device_id]
    );
    
    // Format the client response
    const clientResponse = {
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      address: {
        street: client.street
      },
      status: client.status,
      device_id: client.device_id || generateDeviceId(client.id)
    };
    
    // Add device data if available
    if (deviceRows.length > 0) {
      clientResponse.device = deviceRows[0];
    }
    
    res.json(clientResponse);
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message);
  }
});


// Delete a device
app.delete('/api/devices/:imei', async (req, res) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM devices WHERE imei = ?',
      [req.params.imei]
    );
    
    if (result.affectedRows === 0) return res.status(404).send('Device not found');
    
    res.status(200).send('Device deleted successfully');
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).send(error.message);
  }
});

  // Update the client creation endpoint to handle manual device ID entry

app.post('/api/clients', async (req, res) => {
  try {
    const { 
      name, email, phone, 
      address = {}, status, password = 'Megha@9000',
      device_id // Can now be provided directly
    } = req.body;
    
    const [result] = await pool.execute(
      `INSERT INTO clients 
       (name, email, phone, street, status, password) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name, email, phone, 
        address.street || null, status || 'pending', password
      ]
    );
    
    // Use provided device_id or generate one if not provided
    const finalDeviceId = device_id || generateDeviceId(result.insertId);
    await pool.execute(
      `UPDATE clients SET device_id = ? WHERE id = ?`,
      [finalDeviceId, result.insertId]
    );
    
    res.status(201).json({
      id: result.insertId,
      name,
      email,
      phone,
      address,
      status,
      password,
      device_id: finalDeviceId
    });
  } catch (error) {
    console.error(error);
    res.status(400).send(error.message);
  }
});

app.get('/api/clients/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM clients WHERE id = ?', 
      [req.params.id]
    );
    
    if (rows.length === 0) return res.status(404).send('Client not found');
    
    const client = rows[0];
    // Format the response
    res.json({
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      address: {
        street: client.street
      },
      status: client.status,
      password: client.password || 'Megha@9000',
      device_id: client.device_id || generateDeviceId(client.id)
    });
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message);
  }
});


// Session check endpoint
app.post('/api/session/refresh', (req, res) => {
  // In a real app with authentication, you might validate a token here
  // For this demo, we'll just confirm the session refresh request
  res.json({ success: true, message: 'Session refreshed' });
});

// Session status check endpoint
app.get('/api/session/check', (req, res) => {
  // This endpoint would typically validate a session token
  // Here we just respond with success
  res.json({ valid: true });
});

// Start the HTTP server on a different port to avoid conflict with TCP server
const HTTP_PORT = 2026;
app.listen(HTTP_PORT, () => {
  console.log(`HTTP server is running on http://localhost:${HTTP_PORT}`);
});
