// Quick SMTP connectivity + send test for Gmail.
// Usage: node apps/api/scripts/smtp-test.js recipient@example.com
const nodemailer = require('nodemailer');

const to = process.argv[2] || 'xsultarma007@gmail.com';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'xursanalime@gmail.com',
    pass: 'kbayujkyfusvdjra',
  },
  logger: true,
  debug: true,
});

(async () => {
  try {
    console.log('Verifying SMTP connection...');
    await transporter.verify();
    console.log('✅ SMTP connection OK');

    const info = await transporter.sendMail({
      from: 'EduBridge <xursanalime@gmail.com>',
      to,
      subject: 'EduBridge SMTP test',
      text: 'Bu test xabari. Agar buni ko\'rsangiz, SMTP ishlayapti.',
    });
    console.log('✅ Sent:', info.messageId);
    console.log('Response:', info.response);
    console.log('Accepted:', info.accepted);
    console.log('Rejected:', info.rejected);
  } catch (err) {
    console.error('❌ SMTP ERROR:', err.message);
    console.error(err);
  } finally {
    process.exit(0);
  }
})();
