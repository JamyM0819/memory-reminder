const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

// Support environment variables for cloud deployment
function loadOrGenerateKeys() {
  // Cloud: use env vars if set
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY
    };
  }

  // Local dev: store in data/vapid.json
  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  const vapidPath = path.join(dataDir, 'vapid.json');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  if (fs.existsSync(vapidPath)) {
    return JSON.parse(fs.readFileSync(vapidPath, 'utf8'));
  }

  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(vapidPath, JSON.stringify(keys, null, 2));
  return keys;
}

const vapidKeys = loadOrGenerateKeys();

webpush.setVapidDetails(
  'mailto:memory-reminder@localhost',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

function sendNotification(subscription, memoContent) {
  const payload = JSON.stringify({
    title: '🔔 到时间复习了',
    body: memoContent,
    icon: '/icon-192.svg',
    badge: '/icon-96.svg',
    vibrate: [200, 100, 200]
  });

  return webpush.sendNotification(subscription, payload);
}

function getPublicKey() {
  return vapidKeys.publicKey;
}

module.exports = { sendNotification, getPublicKey };
