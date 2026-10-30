// Sends email through Resend when RESEND_API_KEY is set. Without it, emails are
// printed to the server log so the flow can be tested.
export type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; contentBase64: string }[];
};

export async function sendEmail(email: Email): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email not sent: no RESEND_API_KEY] to=${email.to} subject="${email.subject}"\n${email.text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Winter Performance Tickets <onboarding@resend.dev>",
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: email.attachments?.map((a) => ({ filename: a.filename, content: a.contentBase64 })),
    }),
  });
  if (!res.ok) throw new Error(`Email failed: ${res.status} ${await res.text()}`);
}
