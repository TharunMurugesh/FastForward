// Calls a local https server (not PayPal) with fetch and node:https. Target comes from TARGET.
import https from 'node:https';

const target = process.env.TARGET;
const viaFetch = (await fetch(`${target}/via-fetch`)).status;
const viaHttps = await new Promise((resolve, reject) => {
  https
    .get(`${target}/via-https`, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    })
    .on('error', reject);
});

console.log(JSON.stringify({ registered: Boolean(globalThis[Symbol.for('fastforward.register')]), viaFetch, viaHttps }));
