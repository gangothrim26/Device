const net = require('net');

const client = new net.Socket();
const PORT = 2025;
const HOST = '127.0.0.1';

client.connect(PORT, HOST, () => {
  console.log(`Connected to server ${HOST}:${PORT}`);
  
  
  
  // Send data with prefix and #END# delimiter
  client.write(`Hello Server! ${JSON.stringify(deviceData)}#END#`);
  console.log('Device data sent with Hello Server! prefix and #END# delimiter');
});

client.on('data', (data) => {
  try {
    const response = JSON.parse(data.toString());
    console.log('Response from server (parsed):', response);
  } catch (e) {
    console.log('Response from server (raw):', data.toString());
  }
  client.end(); // Close connection after receiving response
});

client.on('close', () => {
  console.log('Connection closed');
});

client.on('error', (err) => {
  console.error('Connection error:', err);
});