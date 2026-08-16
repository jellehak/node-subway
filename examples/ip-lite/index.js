import geoip from 'geoip-lite';
import { createRequestHandler } from '../../bin/subway.js';

const app = createRequestHandler({
  target: 'http://192.168.1.1:8080',
  port: 80,
  log: true,
});

// Add geoip hook to log request location info
app.hook((onRequest, onResponse) => {
  onRequest((req, res) => {
    const clientIp = req.clientIp;
    const geo = geoip.lookup(clientIp);
    
    console.log(`📍 Request from ${clientIp}`);
    if (geo) {
      console.log(`   Country: ${geo.country}, Region: ${geo.region}, City: ${geo.city}`);
      console.log(`   Coordinates: ${geo.ll[0]}, ${geo.ll[1]}`);
    }
  });
});

app.listen();
