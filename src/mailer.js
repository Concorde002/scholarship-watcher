import nodemailer from 'nodemailer';

export function describeMailConfig(mail) {
  if (!mail.to) return { configured: false, reason: 'DIGEST_TO is not set' };
  if (mail.resendKey) {
    return mail.from
      ? { configured: true, transport: 'resend' }
      : { configured: false, reason: 'MAIL_FROM is required with Resend' };
  }
  if (mail.smtpHost && mail.smtpUser && mail.smtpPass) {
    return { configured: true, transport: `smtp:${mail.smtpHost}:${mail.smtpPort}` };
  }
  return { configured: false, reason: 'No SMTP credentials or Resend API key configured' };
}

async function sendWithResend({ subject, html, text }, mail) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${mail.resendKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: mail.from,
      to: [mail.to],
      subject,
      html,
      text,
    }),
    signal: AbortSignal.timeout(25_000),
  });

  const body = await response.text();
  if (!response.ok) throw new Error(`Resend HTTP ${response.status}: ${body.slice(0, 300)}`);
  return { id: JSON.parse(body).id ?? null };
}

async function sendWithSmtp({ subject, html, text }, mail) {
  const transport = nodemailer.createTransport({
    host: mail.smtpHost,
    port: mail.smtpPort,
    secure: mail.smtpSecure,
    auth: { user: mail.smtpUser, pass: mail.smtpPass },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

  const info = await transport.sendMail({
    from: mail.from,
    to: mail.to,
    subject,
    text,
    html,
  });
  transport.close();
  return { id: info.messageId ?? null };
}

export async function sendDigest({ subject, html, text }, mail) {
  const status = describeMailConfig(mail);
  if (!status.configured) {
    return { sent: false, skipped: true, reason: status.reason };
  }
  try {
    const result = mail.resendKey
      ? await sendWithResend({ subject, html, text }, mail)
      : await sendWithSmtp({ subject, html, text }, mail);
    return { sent: true, transport: status.transport, ...result };
  } catch (error) {
    return { sent: false, skipped: false, reason: error.message };
  }
}

export async function sendTestEmail(mail) {
  const subject = 'Scholarship Watcher · test email';
  const text = [
    'Scholarship Watcher is connected.',
    '',
    'You will get one digest per day with only fully funded opportunities that show no application fee.',
    'If you received this, SMTP/Resend delivery works.',
  ].join('\n');
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;color:#15211c;">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#0f6b4f;font-weight:700;">Scholarship Watcher</div>
    <h1 style="font-family:Georgia,serif;font-size:26px;margin:10px 0 14px;">It is connected.</h1>
    <p style="font-size:15px;line-height:1.6;color:#3f3b33;">You will get one digest per day with only fully funded opportunities that show no application fee.</p>
    <p style="font-size:13px;line-height:1.6;color:#8a8578;">This is a delivery test. Your first real digest arrives at the scheduled time.</p>
  </div>`;
  return sendDigest({ subject, html, text }, mail);
}
