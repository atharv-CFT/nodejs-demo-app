import { createRequire } from "module";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Using import or export module
import express from "express";
import pkg from 'pg';
import bodyParser from 'body-parser';
import os from 'os';

import { publicIp, publicIpv4, publicIpv6 } from 'public-ip';

const { Pool } = pkg;

// For PostgreSQL
// Connection details are read from environment variables so the same image
// can run locally, in Docker Compose, or in production without code changes.
const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'mydatabase',
});

// Create the table if it doesn't already exist, then confirm the connection.
// Retries a few times because in Docker Compose the app container can start
// before the PostgreSQL container has finished initializing.
async function connectToPostgres(retries = 10, delayMs = 3000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS mycollection (
                    id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL UNIQUE,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);
            console.log('Connected to PostgreSQL server');
            return;
        } catch (error) {
            console.error(`Postgres connection attempt ${attempt}/${retries} failed:`, error.message);
            if (attempt === retries) {
                console.error('Could not connect to PostgreSQL, continuing without DB (endpoints using it will fail)');
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
}

connectToPostgres();

const app = express();
const PORT = process.env.PORT || 5000;

// Home page
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Health check endpoint (used by Docker healthcheck / load balancers)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Parse incoming requests with JSON payloads
app.use(express.json());
app.use(express.static('/')); // Serve static files from root directory also we can use 'public' directory

// Insert data into PostgreSQL server
app.post('/insertData', async (req, res) => {
    const { name, email } = req.body;

    try {
        // Check for duplicates
        const existing = await pool.query('SELECT id FROM mycollection WHERE email = $1', [email]);

        if (existing.rows.length > 0) {
            return res.send(' email already exists, user adding fail!!');
            // return res.status(400).send(' email already exists');
        }

        // Insert the data
        await pool.query('INSERT INTO mycollection (name, email) VALUES ($1, $2)', [name, email]);
        res.status(200).send(' added successfully');
        //   console.log('User added successfully....')

    } catch (error) {
        // console.error('Error inserting data:', error);
        return res.status(500).send(' add Error');
    }
});

// Get data from PostgreSQL server
app.get('/fetchData', async (req, res) => {
    const result = await pool.query('SELECT * FROM mycollection ORDER BY id DESC LIMIT 12');
    res.json(result.rows);
    // console.log('User fetch successfully....')
});


// Find host and ip address
app.get('/hostinfo', async (req, res) => {

    const hostname = os.hostname(); // Get the server's hostname
    const networkInterfaces = os.networkInterfaces();
    let privateIp = '';

    // Find the private IP address
    for (const iface in networkInterfaces) {
        for (let i = 0; i < networkInterfaces[iface].length; i++) {
            if (networkInterfaces[iface][i].family === 'IPv4' && !networkInterfaces[iface][i].internal) {
                privateIp = networkInterfaces[iface][i].address;
                break;
            }
        }
        if (privateIp) break;
    }
    let publicIpAddress = await publicIpv4();

    const hostinfo = {
        hostname,
        privateIp,
        publicIpAddress
    };
    res.json(hostinfo);
});

app.listen(PORT, () => {
    console.log('Server is running on', PORT);
});