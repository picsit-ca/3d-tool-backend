const path = require('path');

// Change to the backend directory where the .env file is located
process.chdir(path.join(__dirname));

// Now load the environment variables and start the server
require('dotenv').config();
require('./server.js');