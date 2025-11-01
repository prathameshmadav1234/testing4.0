const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const db = admin.database();

// Cloud Function triggered on new log entries to update report
exports.updateReportOnNewLog = functions.database.ref('/logs/{userId}/{date}/{logId}')
  .onCreate(async (snapshot, context) => {
    const { userId, date } = context.params;
    const newLog = snapshot.val();

    try {
      // Fetch all logs for the date
      const logsRef = db.ref(`logs/${userId}/${date}`);
      const logsSnapshot = await logsRef.once('value');
      const logs = logsSnapshot.val();

      if (!logs) return;

      // Convert to array and sort
      const logsArray = Object.values(logs).sort((a, b) => a.timestamp - b.timestamp);

      // Generate CSV content
      const headers = ['Time', 'LED State', 'Brightness (%)', 'Pot Value'];
      const csvContent = [headers.join(','), ...logsArray.map(log =>
        `${log.time},${log.ledState},${log.brightness},${log.potValue}`
      )].join('\n');

      // Store the updated CSV in Firebase Storage
      const bucket = admin.storage().bucket();
      const fileName = `reports/${userId}/${date}_report.csv`;
      const file = bucket.file(fileName);
      await file.save(csvContent, {
        metadata: {
          contentType: 'text/csv',
        },
      });

      console.log(`Updated report for user ${userId} on ${date}`);
    } catch (error) {
      console.error('Error updating report:', error);
    }
  });

// Cloud Function to get download URL for report
exports.getReportDownloadUrl = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const userId = context.auth.uid;
  const date = data.date || new Date().toISOString().split('T')[0];

  try {
    const bucket = admin.storage().bucket();
    const fileName = `reports/${userId}/${date}_report.csv`;
    const file = bucket.file(fileName);

    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      // Generate report on-demand if it doesn't exist
      const logsRef = db.ref(`logs/${userId}/${date}`);
      const snapshot = await logsRef.once('value');
      const logs = snapshot.val();

      if (!logs) {
        return { message: 'No logs found for this date' };
      }

      // Convert to array and sort
      const logsArray = Object.values(logs).sort((a, b) => a.timestamp - b.timestamp);

      // Generate CSV content
      const headers = ['Time', 'LED State', 'Brightness (%)', 'Pot Value'];
      const csvContent = [headers.join(','), ...logsArray.map(log =>
        `${log.time},${log.ledState},${log.brightness},${log.potValue}`
      )].join('\n');

      // Store the CSV in Firebase Storage
      await file.save(csvContent, {
        metadata: {
          contentType: 'text/csv',
        },
      });
    }

    // Generate signed URL (valid for 1 hour)
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
    });

    return { downloadUrl: url, fileName: `${date}_ESP32_Logs.csv` };
  } catch (error) {
    console.error('Error getting download URL:', error);
    throw new functions.https.HttpsError('internal', 'Error retrieving report');
  }
});

// Scheduled function to auto-generate reports (runs daily at midnight)
exports.scheduledReportGeneration = functions.pubsub.schedule('0 0 * * *').onRun(async (context) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = yesterday.toISOString().split('T')[0];

  // Get all users
  const usersRef = db.ref('logs');
  const usersSnapshot = await usersRef.once('value');
  const users = usersSnapshot.val();

  if (!users) return;

  for (const userId in users) {
    if (users[userId][date]) {
      // Generate report for this user and date
      try {
        const logsRef = db.ref(`logs/${userId}/${date}`);
        const snapshot = await logsRef.once('value');
        const logs = snapshot.val();

        const logsArray = Object.values(logs).sort((a, b) => a.timestamp - b.timestamp);
        const headers = ['Time', 'LED State', 'Brightness (%)', 'Pot Value'];
        const csvContent = [headers.join(','), ...logsArray.map(log =>
          `${log.time},${log.ledState},${log.brightness},${log.potValue}`
        )].join('\n');

        // Store in Storage
        const bucket = admin.storage().bucket();
        const fileName = `reports/${userId}/${date}_report.csv`;
        const file = bucket.file(fileName);
        await file.save(csvContent, {
          metadata: {
            contentType: 'text/csv',
          },
        });

        console.log(`Generated scheduled report for user ${userId} on ${date}`);
      } catch (error) {
        console.error(`Error generating scheduled report for user ${userId}:`, error);
      }
    }
  }
});
