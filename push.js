const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const VAPID_KEYS_PATH = path.join(__dirname, 'data', 'vapid.json');

function loadOrGenerateKeys() {
  const dir = path.dirname(VAPID_KEYS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(VAPID_KEYS_PATH)) {
    return JSON.parse(fs.readFileSync(VAPID_KEYS_PATH, 'utf8'));
  }

  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_KEYS_PATH, JSON.stringify(keys, null, 2));
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
