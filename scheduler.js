const cron = require('node-cron');
const push = require('./push');

function isInDND(settings) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat
  const isWeekend = day === 0 || day === 6;

  const startKey = isWeekend ? 'dnd_weekend_start' : 'dnd_weekday_start';
  const endKey = isWeekend ? 'dnd_weekend_end' : 'dnd_weekday_end';

  const start = settings[startKey];
  const end = settings[endKey];
  if (!start || !end) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  // Handle overnight DND (e.g., 23:00 ~ 07:00)
  if (startMinutes <= endMinutes) {
    // Same-day range (e.g., 09:00 ~ 17:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight range (e.g., 23:00 ~ 07:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

function start(db) {
  const d = new Date();
  console.log(`[${d.toLocaleString()}] Scheduler started. Checking every minute.`);

  cron.schedule('* * * * *', async () => {
    try {
      const settings = db.getAllSettings();

      // Skip if currently in DND period
      if (isInDND(settings)) {
        return;
      }

      const dueReminders = db.getDueReminders();
      if (dueReminders.length === 0) return;

      const subscriptions = db.getAllSubscriptions();
      if (subscriptions.length === 0) return;

      for (const reminder of dueReminders) {
        try {
          for (const sub of subscriptions) {
            const pushSub = { endpoint: sub.endpoint, keys: sub.keys };
            await push.sendNotification(pushSub, reminder.memo_title || '', reminder.memo_content);
          }
          db.markNotified(reminder.id);
          console.log(`[${new Date().toLocaleString()}] Sent reminder #${reminder.id}: ${reminder.memo_content.substring(0, 40)}...`);
        } catch (err) {
          console.error(`Failed to send reminder #${reminder.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error('Scheduler error:', err.message);
    }
  });
}

module.exports = { start };
