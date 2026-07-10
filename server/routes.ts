import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import OpenAI from "openai";
import { Resend } from "resend";
import twilio from "twilio";
import multer from "multer";
import PDFDocument from "pdfkit";

// ADMIN_PASSWORD must be set via env — no hardcoded fallback
function getAdminPassword() {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) throw new Error("ADMIN_PASSWORD env var not set");
  return pw;
}

// Simple brute-force guard for admin login
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && now < entry.resetAt) {
    if (entry.count >= 5) return false; // blocked
    entry.count++;
  } else {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
  }
  return true;
}

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

const CALLBACK_MESSAGE = `Thank you so much for pre-qualifying with Colony City Finance. Your pre-qualification looks great, and we are so excited to work with you! A loan advisor will be with you shortly. In the meantime, there are a few things you will want to have ready to make the process quick and easy. You will need your Social Security card, proof of income, and a valid Georgia ID. If you would like to get a head start, you are welcome to email those documents to michael at colony city finance dot com. Again, thank you for choosing Colony City Finance, and an advisor will be reaching out to you very soon.`;

async function sendCallbackSMS(toPhone: string) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    console.warn("Twilio credentials not configured — SMS skipped");
    return null;
  }
  try {
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const message = await client.messages.create({
      to: toPhone,
      from: TWILIO_FROM_NUMBER,
      body: `Hi! Thank you for pre-qualifying with Colony City Finance. Your pre-qualification looks great! 🎉\n\nTo speed up your process, please have the following ready:\n• Social Security card\n• Proof of income\n• Valid Georgia ID\n\nYou can email documents to michael@colonycityfinance.com\n\nA loan advisor will be calling you shortly!`,
    });
    console.log(`SMS sent: ${message.sid} to ${toPhone}`);
    return message.sid;
  } catch (err: any) {
    console.error("Twilio SMS failed:", err?.message);
    throw err;
  }
}

async function makeCallbackCall(toPhone: string, appBaseUrl: string) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    console.warn("Twilio credentials not configured — outbound call skipped");
    return null;
  }
  try {
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const call = await client.calls.create({
      to: toPhone,
      from: TWILIO_FROM_NUMBER,
      twiml: `<Response><Say voice="Polly.Joanna-Neural">${CALLBACK_MESSAGE}</Say></Response>`,
    });
    console.log(`Outbound callback call initiated: ${call.sid} to ${toPhone}`);
    return call.sid;
  } catch (err: any) {
    console.error("Twilio callback call failed:", err?.message);
    throw err;
  }
}

const SYSTEM_PROMPT = `You are Steph, a warm and personable loan advisor for Colony City Finance. You have a friendly, upbeat personality — like a helpful person at a local bank who genuinely wants to see you succeed. Your job is to pre-qualify someone for a personal loan by collecting 6 pieces of information, then close by telling them a specialist will call.

Collect in this order:
1. First name
2. Loan amount needed
3. Credit score range (Below 580 / 580-669 / 670-739 / 740-799 / 800+)
4. Employment status (Employed full-time / part-time / Self-employed / Unemployed / Retired)
5. Monthly gross income
6. Phone number

Personality guidelines:
- Be warm and encouraging — a quick genuine comment on their answer is great (e.g. "That's a solid goal!" or "Good to know!")
- Light personality is welcome, but keep it brief — one short reaction, then the next question
- Never judgmental about credit scores or income — always reassuring
- If someone has a lower credit score, briefly mention Colony City Finance works with all credit profiles

Strict rules:
- Keep every message to 2-3 sentences MAX — reaction + next question
- Ask ONE question per message
- Be flexible with answers — if someone gives a reasonable, natural-language answer that contains the info you need, accept it and move on. Do NOT require them to use exact wording or pick from a list.
- Examples of acceptable answers: "I make about 3 grand a month" (monthly income), "I work full time at a warehouse" (employed full-time), "somewhere around 650" (credit score range 580-669), "my number is 229-555-1234" (phone number)
- Only re-ask if the answer is genuinely unrelated or completely unclear — for example, if someone responds with a joke, a question back to you, or something totally off-topic. In that case, gently redirect: "Ha, let me keep us moving — [re-ask the same question]?"
- NEVER discuss topics outside of the pre-qualification process — no financial advice, no tangents beyond one brief warm reaction
- Never give financial advice, specific rates, or guarantees
- Stay focused on the pre-qualification — don't let the conversation drift more than one exchange
- After collecting all 6 items, give a warm 2-sentence closing, tell them a loan specialist will call them shortly, and then tell them the next steps: (1) complete the Consent Form by clicking the "Consent Form" tab at the top, and (2) upload their ID and proof of income by clicking the "Documents" tab — both only take a minute and will help get things moving faster
- Do NOT make specific loan offers, rates, or guarantees
- Use plain text only — no em dashes (—), no smart/curly quotes (“”), no asterisks, no markdown, no citation numbers like [1] or [2] or [3]

When you have collected ALL required information (name, loan amount, credit score, employment status, monthly income, phone number), end your final message with this exact JSON block on a new line:
<QUALIFICATION_COMPLETE>
{"name":"<name>","loanAmount":"<amount>","creditScore":"<score range>","employmentStatus":"<status>","monthlyIncome":"<income>","phone":"<phone>","score":"<hot|warm|cold>"}
</QUALIFICATION_COMPLETE>

Score rubric:
- hot: credit 670+, employed, income $3000+/mo
- warm: credit 580-669, OR income $2000-2999/mo, OR part-time/self-employed
- cold: credit below 580, OR unemployed, OR income below $2000/mo

Start by warmly greeting the visitor and asking their first name.`;

let pplxClient: OpenAI | null = null;
function getClient() {
  if (!pplxClient) {
    const key = process.env.PPLX_API_KEY;
    if (!key) throw new Error("PPLX_API_KEY not set");
    pplxClient = new OpenAI({ apiKey: key, baseURL: "https://api.perplexity.ai" });
  }
  return pplxClient;
}

async function sendLeadNotification(lead: {
  name: string;
  phone: string;
  loanAmount: string;
  creditScore: string;
  employmentStatus: string;
  monthlyIncome: string;
  qualificationScore: string;
}) {
  // Check both the direct env var and the pplx.app credential proxy var name
  const resendKey = process.env.RESEND_API_KEY || process.env.CUSTOM_CRED_API_RESEND_COM_TOKEN;
  if (!resendKey) {
    console.warn("Email notifications not configured — set RESEND_API_KEY");
    return;
  }

  const scoreEmoji = lead.qualificationScore === "hot" ? "🔥" : lead.qualificationScore === "warm" ? "🌤️" : "❄️";
  const scoreLabel = lead.qualificationScore.toUpperCase();
  const scoreColor = lead.qualificationScore === "hot" ? "#ef4444" : lead.qualificationScore === "warm" ? "#f59e0b" : "#60a5fa";

  const resend = new Resend(resendKey);
  const { error } = await resend.emails.send({
    from: "Colony City Finance Leads <onboarding@resend.dev>",
    to: "michael@colonycityfinance.com",
    subject: `${scoreEmoji} New Loan Lead: ${lead.name} (${scoreLabel})`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f172a;color:#f1f5f9;padding:32px;border-radius:12px">
        <h2 style="color:#f59e0b;margin:0 0 8px">New Pre-Qualification Completed</h2>
        <p style="color:#94a3b8;margin:0 0 24px">Someone just finished the Colony City Finance chatbot. Here are their details:</p>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:10px 0;border-bottom:1px solid #1e293b;color:#94a3b8;width:45%">Name</td><td style="padding:10px 0;border-bottom:1px solid #1e293b;font-weight:600">${lead.name}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1e293b;color:#94a3b8">Phone</td><td style="padding:10px 0;border-bottom:1px solid #1e293b;font-weight:600">${lead.phone}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1e293b;color:#94a3b8">Loan Amount</td><td style="padding:10px 0;border-bottom:1px solid #1e293b">${lead.loanAmount}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1e293b;color:#94a3b8">Credit Score</td><td style="padding:10px 0;border-bottom:1px solid #1e293b">${lead.creditScore}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1e293b;color:#94a3b8">Employment</td><td style="padding:10px 0;border-bottom:1px solid #1e293b">${lead.employmentStatus}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #1e293b;color:#94a3b8">Monthly Income</td><td style="padding:10px 0;border-bottom:1px solid #1e293b">${lead.monthlyIncome}/mo</td></tr>
          <tr><td style="padding:10px 0;color:#94a3b8">Lead Score</td><td style="padding:10px 0;font-weight:700;color:${scoreColor}">${scoreEmoji} ${scoreLabel}</td></tr>
        </table>
        <p style="margin:24px 0 0;color:#94a3b8;font-size:13px">Call them as soon as possible — hot and warm leads convert best within the first hour.</p>
      </div>
    `,
  });

  if (error) {
    console.error("Resend email error:", JSON.stringify(error));
  } else {
    console.log(`Lead notification email sent for ${lead.name}`);
  }
}

function generateConsentPDF(data: {
  fullName: string; dob: string; ssn: string; address: string;
  city: string; state: string; zip: string; phone: string;
  email: string; loanAmount: string; signatureName: string; signatureDate: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: 'LETTER' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#b45309';
    const dark = '#1e293b';
    const mid  = '#475569';
    const W = doc.page.width - 112;

    // Header bar
    doc.rect(56, 40, W, 48).fill(dark);
    doc.fillColor('#f59e0b').font('Helvetica-Bold').fontSize(15)
       .text('Colony City Finance', 72, 53, { width: W - 32 });
    doc.fillColor('#94a3b8').font('Helvetica').fontSize(9)
       .text('FCRA Credit Pull Authorization & Consent Form', 72, 72, { width: W - 32 });

    doc.moveDown(3);

    // Section helper
    const section = (title: string) => {
      doc.moveDown(0.6);
      doc.fillColor(gold).font('Helvetica-Bold').fontSize(8)
         .text(title.toUpperCase(), { characterSpacing: 1 });
      doc.moveTo(56, doc.y + 2).lineTo(56 + W, doc.y + 2).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      doc.moveDown(0.5);
    };

    // Row helper
    const row = (label: string, value: string) => {
      const y = doc.y;
      doc.fillColor(mid).font('Helvetica').fontSize(9).text(label, 56, y, { width: 160 });
      doc.fillColor(dark).font('Helvetica').fontSize(9).text(value || '—', 220, y, { width: W - 164 });
      doc.moveDown(0.55);
    };

    // Applicant info
    section('Applicant Information');
    row('Full Legal Name', data.fullName);
    row('Date of Birth', data.dob || '—');
    row('Social Security Number', data.ssn || '—');
    row('Address', [data.address, data.city, data.state, data.zip].filter(Boolean).join(', ') || '—');
    row('Phone', data.phone || '—');
    row('Email', data.email || '—');
    row('Requested Loan Amount', data.loanAmount || '—');

    // Authorization text
    section('Authorization & Consent');
    const authText = [
      `I, the undersigned applicant, hereby authorize Colony City Finance and its agents, employees, or affiliates, to obtain a consumer credit report and/or any other investigative report from one or more consumer reporting agencies in connection with my application for a loan or extension of credit.`,
      `I understand and acknowledge that this authorization is made pursuant to the Fair Credit Reporting Act (FCRA), 15 U.S.C. § 1681 et seq., and that Colony City Finance will use this report solely to evaluate my creditworthiness for the purpose of the loan transaction described above.`,
      `I further authorize Colony City Finance to verify any information provided in my application, including employment, income, and identity, through any lawful means. I certify that all information provided is true and accurate to the best of my knowledge.`,
      `I understand I have rights under the FCRA, including the right to receive a copy of any consumer report obtained, and to dispute inaccurate information contained therein.`,
      `This consent shall remain in effect for 90 days from the date signed below, or until my loan application is withdrawn or completed, whichever occurs first.`,
    ];
    authText.forEach(p => {
      doc.fillColor('#334155').font('Helvetica').fontSize(9).text(p, { width: W, align: 'justify' });
      doc.moveDown(0.5);
    });

    // Signature
    section('Electronic Signature');
    doc.moveDown(0.3);
    // Signature name in italic
    doc.fillColor('#1e3a8a').font('Helvetica-Oblique').fontSize(22)
       .text(data.signatureName || '', 56, doc.y, { width: W });
    doc.moveDown(0.3);
    doc.moveTo(56, doc.y).lineTo(260, doc.y).strokeColor('#1e3a8a').lineWidth(1).stroke();
    doc.moveDown(0.6);
    doc.fillColor(mid).font('Helvetica').fontSize(9)
       .text(`Signed electronically on ${data.signatureDate || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, 56);
    doc.moveDown(0.3);
    doc.fillColor(mid).font('Helvetica').fontSize(8)
       .text('By submitting this form, the applicant authorized Colony City Finance to obtain a consumer credit report pursuant to the FCRA, 15 U.S.C. § 1681 et seq. This electronic signature is legally binding.', 56, doc.y, { width: W });

    // Footer
    const pageH = doc.page.height;
    doc.rect(56, pageH - 52, W, 28).fill('#f8fafc');
    doc.fillColor(mid).font('Helvetica').fontSize(7.5)
       .text('Colony City Finance  ·  This document is protected under the Fair Credit Reporting Act (FCRA). Unauthorized use is prohibited.', 64, pageH - 44, { width: W - 16, align: 'center' });

    doc.end();
  });
}

async function sendConsentFormEmail(data: {
  fullName: string;
  dob: string;
  ssn: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  loanAmount: string;
  signatureName: string;
  signatureDate: string;
}) {
  const resendKey = process.env.RESEND_API_KEY || process.env.CUSTOM_CRED_API_RESEND_COM_TOKEN;
  if (!resendKey) {
    console.warn("Email notifications not configured — consent form email skipped");
    return;
  }
  const resend = new Resend(resendKey);

  // Generate signed PDF
  let pdfBuffer: Buffer | null = null;
  try {
    pdfBuffer = await generateConsentPDF(data);
  } catch (pdfErr: any) {
    console.error("PDF generation failed:", pdfErr?.message);
  }

  const emailPayload: any = {
    from: "Colony City Finance Leads <onboarding@resend.dev>",
    to: "michael@colonycityfinance.com",
    subject: `📋 Consent Form Submitted — ${data.fullName}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#0f172a;color:#f1f5f9;padding:32px;border-radius:12px">
        <h2 style="color:#f59e0b;margin:0 0 6px">Credit Pull Authorization Received</h2>
        <p style="color:#94a3b8;margin:0 0 24px;font-size:14px">A customer has completed and submitted their FCRA consent form. The signed PDF is attached.</p>

        <h3 style="color:#e2e8f0;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 12px">Applicant Details</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
          <tr><td style="padding:9px 0;border-bottom:1px solid #1e293b;color:#94a3b8;width:45%;font-size:13px">Full Name</td><td style="padding:9px 0;border-bottom:1px solid #1e293b;font-weight:600;font-size:13px">${data.fullName}</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:13px">Date of Birth</td><td style="padding:9px 0;border-bottom:1px solid #1e293b;font-size:13px">${data.dob || "—"}</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:13px">SSN</td><td style="padding:9px 0;border-bottom:1px solid #1e293b;font-size:13px">${data.ssn || "—"}</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:13px">Address</td><td style="padding:9px 0;border-bottom:1px solid #1e293b;font-size:13px">${[data.address, data.city, data.state, data.zip].filter(Boolean).join(", ") || "—"}</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:13px">Phone</td><td style="padding:9px 0;border-bottom:1px solid #1e293b;font-size:13px">${data.phone || "—"}</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:13px">Email</td><td style="padding:9px 0;border-bottom:1px solid #1e293b;font-size:13px">${data.email || "—"}</td></tr>
          <tr><td style="padding:9px 0;color:#94a3b8;font-size:13px">Loan Amount</td><td style="padding:9px 0;font-size:13px">${data.loanAmount || "—"}</td></tr>
        </table>

        <h3 style="color:#e2e8f0;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 12px">Electronic Signature</h3>
        <div style="background:#1e293b;border-radius:8px;padding:16px 20px;margin-bottom:24px">
          <p style="font-family:'Georgia',serif;font-size:28px;color:#60a5fa;margin:0 0 8px;font-style:italic">${data.signatureName}</p>
          <p style="color:#64748b;font-size:12px;margin:0">Signed electronically on ${data.signatureDate}</p>
        </div>

        <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:14px 16px">
          <p style="color:#64748b;font-size:11px;margin:0;line-height:1.6">
            By submitting this form, the applicant authorized Colony City Finance to obtain a consumer credit report
            pursuant to the Fair Credit Reporting Act (FCRA), 15 U.S.C. § 1681 et seq. This electronic signature
            is legally binding.
          </p>
        </div>
      </div>
    `,
  };

  if (pdfBuffer) {
    const safeName = data.fullName.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
    emailPayload.attachments = [{
      filename: `Consent_Form_${safeName}.pdf`,
      content: pdfBuffer.toString('base64'),
    }];
  }

  const { error } = await resend.emails.send(emailPayload);
  if (error) {
    console.error("Consent form email error:", JSON.stringify(error));
  } else {
    console.log(`Consent form email sent for ${data.fullName}`);
  }
}

async function sendDocumentEmail(fields: { name: string; phone: string }, files: { fieldname: string; originalname: string; mimetype: string; buffer: Buffer }[]) {
  const resendKey = process.env.RESEND_API_KEY || process.env.CUSTOM_CRED_API_RESEND_COM_TOKEN;
  if (!resendKey) {
    console.warn("Email notifications not configured — document email skipped");
    return;
  }
  const resend = new Resend(resendKey);

  const attachments = files.map(f => ({
    filename: f.originalname,
    content: f.buffer,
  }));

  const fileList = files.map(f => {
    const label = f.fieldname === 'idDocument' ? 'Government-Issued ID' : 'Proof of Income';
    return `<tr><td style="padding:9px 0;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:13px;width:45%">${label}</td><td style="padding:9px 0;border-bottom:1px solid #1e293b;font-size:13px">${f.originalname}</td></tr>`;
  }).join('');

  const { error } = await resend.emails.send({
    from: "Colony City Finance Leads <onboarding@resend.dev>",
    to: "michael@colonycityfinance.com",
    subject: `📎 Documents Submitted — ${fields.name}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#0f172a;color:#f1f5f9;padding:32px;border-radius:12px">
        <h2 style="color:#f59e0b;margin:0 0 6px">Documents Received</h2>
        <p style="color:#94a3b8;margin:0 0 24px;font-size:14px">A customer has uploaded their verification documents.</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
          <tr><td style="padding:9px 0;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:13px;width:45%">Name</td><td style="padding:9px 0;border-bottom:1px solid #1e293b;font-weight:600;font-size:13px">${fields.name}</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:13px">Phone</td><td style="padding:9px 0;border-bottom:1px solid #1e293b;font-size:13px">${fields.phone}</td></tr>
          ${fileList}
        </table>
        <p style="color:#64748b;font-size:12px;margin:0">Documents are attached to this email.</p>
      </div>
    `,
    attachments,
  });

  if (error) {
    console.error("Document email error:", JSON.stringify(error));
  } else {
    console.log(`Document email sent for ${fields.name}`);
  }
}

// Schemas
const saveTurnSchema = z.object({
  sessionId: z.string(),
  userMessage: z.string().max(1000),
  assistantMessage: z.string().max(4000),
});

const saveLeadSchema = z.object({
  sessionId: z.string(),
  name: z.string(),
  phone: z.string(),
  loanAmount: z.string(),
  creditScore: z.string(),
  employmentStatus: z.string(),
  monthlyIncome: z.string(),
  qualificationScore: z.string(),
});

const consentFormSchema = z.object({
  fullName: z.string().min(1),
  dob: z.string().optional().default(""),
  ssn: z.string().optional().default(""),
  address: z.string().optional().default(""),
  city: z.string().optional().default(""),
  state: z.string().optional().default(""),
  zip: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  email: z.string().optional().default(""),
  loanAmount: z.string().optional().default(""),
  signatureName: z.string().min(1),
  signatureDate: z.string().optional().default(""),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  },
});

export async function registerRoutes(httpServer: Server, app: Express) {

  // Health check — used by the frontend keep-alive ping to warm the sandbox
  app.get("/api/health", (_req, res) => {
    const resendKey = process.env.RESEND_API_KEY || process.env.CUSTOM_CRED_API_RESEND_COM_TOKEN;
    res.json({ ok: true, resendKeyPresent: !!resendKey });
  });

  // Email diagnostic — admin-only (gated with x-admin-password header)
  app.get("/api/email-test", async (req, res) => {
    let adminPw: string;
    try { adminPw = getAdminPassword(); } catch { return res.status(500).json({ error: "Server misconfigured" }); }
    if (req.headers["x-admin-password"] !== adminPw) return res.status(401).json({ error: "Unauthorized" });
    const resendKey = process.env.RESEND_API_KEY || process.env.CUSTOM_CRED_API_RESEND_COM_TOKEN;
    if (!resendKey) return res.status(500).json({ error: "RESEND_API_KEY not set in server environment" });
    try {
      const resend = new Resend(resendKey);
      const { error } = await resend.emails.send({
        from: "Colony City Finance Leads <onboarding@resend.dev>",
        to: "michael@colonycityfinance.com",
        subject: "✅ Server Email Test — System Working",
        html: "<div style='font-family:sans-serif;padding:24px;background:#0f172a;color:#f1f5f9;border-radius:12px'><h2 style='color:#f59e0b'>Server Email Confirmed</h2><p>The live Colony City Finance server successfully sent this email. All future leads will trigger an email automatically.</p></div>",
      });
      if (error) return res.status(500).json({ error, keyPresent: true });
      res.json({ ok: true, message: "Email sent — check michael@colonycityfinance.com" });
    } catch(e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // AI chat proxy — frontend sends message history, server calls Perplexity and returns reply
  const chatSchema = z.object({
    messages: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(4000),
    })).max(50),
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { messages } = chatSchema.parse(req.body);
      const client = getClient();
      const completion = await client.chat.completions.create({
        model: "r-plus",
        max_tokens: 512,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
        ],
      });
      const reply = completion.choices[0]?.message?.content ?? "";
      res.json({ reply });
    } catch (err: any) {
      console.error("Chat error:", err?.message);
      res.status(500).json({ error: "Chat unavailable" });
    }
  });

  // Get conversation history for a session
  app.get("/api/history/:sessionId", (req, res) => {
    try {
      const messages = storage.getMessagesBySession(req.params.sessionId);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  // Save a conversation turn
  app.post("/api/turn", async (req, res) => {
    try {
      const { sessionId, userMessage, assistantMessage } = saveTurnSchema.parse(req.body);
      const now = new Date().toISOString();
      storage.createMessage({ sessionId, role: "user", content: userMessage, createdAt: now });
      storage.createMessage({ sessionId, role: "assistant", content: assistantMessage, createdAt: now });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save turn" });
    }
  });

  // Save a completed lead and send email notification
  app.post("/api/save-lead", async (req, res) => {
    try {
      const data = saveLeadSchema.parse(req.body);
      const lead = storage.createLead({
        name: data.name,
        phone: data.phone,
        loanAmount: data.loanAmount,
        creditScore: data.creditScore,
        employmentStatus: data.employmentStatus,
        monthlyIncome: data.monthlyIncome,
        qualificationScore: data.qualificationScore,
        summary: `${data.name} seeking ${data.loanAmount}. Credit: ${data.creditScore}. Employment: ${data.employmentStatus}. Income: ${data.monthlyIncome}/mo.`,
        createdAt: new Date().toISOString(),
      });
      // Fire notification email (non-blocking)
      sendLeadNotification(data).catch(err => console.error("Email notification failed:", err?.message));

      // Fire outbound callback call + SMS (non-blocking)
      const appBaseUrl = `${req.protocol}://${req.get("host")}`;
      const rawPhone = data.phone.replace(/[^\d+]/g, "");
      const e164Phone = rawPhone.startsWith("+") ? rawPhone : `+1${rawPhone}`;
      makeCallbackCall(e164Phone, appBaseUrl).catch(err => console.error("Callback call failed:", err?.message));
      sendCallbackSMS(e164Phone).catch(err => console.error("Callback SMS failed:", err?.message));

      res.json({ ok: true, id: lead.id });
    } catch (error) {
      res.status(500).json({ error: "Failed to save lead" });
    }
  });

  // Upload documents and email them
  app.post("/api/upload", upload.fields([{ name: 'idDocument', maxCount: 1 }, { name: 'incomeDocument', maxCount: 1 }]), async (req, res) => {
    try {
      const name = (req.body.name || "").trim();
      const phone = (req.body.phone || "").trim();
      if (!name) return res.status(400).json({ error: "Name is required" });
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const fileList = [
        ...(files['idDocument'] || []),
        ...(files['incomeDocument'] || []),
      ];
      if (fileList.length === 0) return res.status(400).json({ error: "At least one document is required" });
      sendDocumentEmail({ name, phone }, fileList).catch(err => console.error("Document email failed:", err?.message));
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Upload error:", error?.message);
      res.status(500).json({ error: "Upload failed" });
    }
  });

  // Submit consent form and send email
  app.post("/api/consent", async (req, res) => {
    try {
      const data = consentFormSchema.parse(req.body);
      sendConsentFormEmail(data).catch(err => console.error("Consent form email failed:", err?.message));
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Consent form error:", error?.message);
      res.status(400).json({ error: "Invalid consent form data" });
    }
  });

  // Reset session
  app.delete("/api/history/:sessionId", async (req, res) => {
    try {
      storage.deleteMessagesBySession(req.params.sessionId);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to reset session" });
    }
  });

  // Admin auth check (rate-limited to 5 attempts per IP per 15 min)
  app.post("/api/admin/login", (req, res) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    if (!checkLoginRateLimit(ip)) {
      return res.status(429).json({ error: "Too many attempts — try again in 15 minutes" });
    }
    let adminPw: string;
    try { adminPw = getAdminPassword(); } catch { return res.status(500).json({ error: "Server misconfigured" }); }
    const { password } = req.body ?? {};
    if (password === adminPw) {
      res.json({ ok: true });
    } else {
      res.status(401).json({ error: "Invalid password" });
    }
  });

  // Get all leads (admin only)
  app.get("/api/leads", async (req, res) => {
    const auth = req.headers["x-admin-password"];
    if (auth !== getAdminPassword()) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const leads = storage.getLeads();
      res.json(leads);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch leads" });
    }
  });
}
