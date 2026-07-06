import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck, Printer, CheckCircle2, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const CURSIVE_FONT = "'Dancing Script', cursive";

function ScriptSignatureDisplay({ name }: { name: string }) {
  return (
    <div
      style={{
        fontFamily: CURSIVE_FONT,
        fontSize: "2rem",
        color: "#1a237e",
        minHeight: "3rem",
        borderBottom: "2px solid #1a237e",
        paddingBottom: "4px",
        letterSpacing: "0.02em",
        lineHeight: 1.2,
        userSelect: "none",
      }}
    >
      {name || <span style={{ color: "#aaa", fontSize: "1rem", fontFamily: "inherit" }}>Signature will appear here</span>}
    </div>
  );
}

export default function ConsentFormPage() {
  const today = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  const [form, setForm] = useState({
    fullName: "",
    dob: "",
    ssn: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    phone: "",
    email: "",
    signatureName: "",
    signatureDate: today,
    loanAmount: "",
  });

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const formRef = useRef<HTMLDivElement>(null);

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  // Mirror typed name into signature when signatureName is blank
  const handleFullNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setForm((prev) => ({
      ...prev,
      fullName: val,
      signatureName: prev.signatureName === prev.fullName ? val : prev.signatureName,
    }));
  };

  const handlePrint = () => window.print();

  const handleSubmit = async () => {
    if (!form.fullName || !form.signatureName) {
      setSubmitError("Please enter your full name and signature before submitting.");
      return;
    }
    setSubmitError("");
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/consent", { ...form });
      setSubmitted(true);
    } catch (err: any) {
      setSubmitError("Something went wrong. Please try again or use the Print option.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Load Dancing Script font */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&display=swap');

        @media print {
          body * { visibility: hidden; }
          #consent-form-print, #consent-form-print * { visibility: visible; }
          #consent-form-print { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }

        .form-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 4px;
          display: block;
        }
        .field-row {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-bottom: 1rem;
        }
        .section-title {
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #888;
          border-bottom: 1px solid #ddd;
          padding-bottom: 4px;
          margin: 1.5rem 0 1rem;
        }
        .consent-body {
          font-size: 0.8rem;
          line-height: 1.6;
          color: #333;
          background: #f8f9fb;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 1rem 1.2rem;
          margin-bottom: 1rem;
        }
        .consent-body p { margin: 0 0 0.6em; }
        .consent-body p:last-child { margin-bottom: 0; }
      `}</style>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8 no-print">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 text-primary text-sm font-medium mb-4">
            <ShieldCheck size={15} />
            FCRA-Compliant Authorization
          </div>
          <h1 className="text-2xl font-bold">Credit Pull Authorization &amp; Consent Form</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Fill out the form below — no download needed. Your signature is applied automatically.
          </p>
        </div>

        <div id="consent-form-print" ref={formRef}>
          {/* Printable header */}
          <div className="hidden print:block text-center mb-6">
            <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>Colony City Finance</div>
            <div style={{ fontSize: "0.8rem", color: "#555" }}>FCRA Credit Pull Authorization &amp; Consent Form</div>
            <div style={{ fontSize: "0.75rem", color: "#888" }}>{today}</div>
          </div>

          {/* Applicant Information */}
          <p className="section-title">Applicant Information</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <div className="field-row">
              <label className="form-label">Full Legal Name</label>
              <Input
                value={form.fullName}
                onChange={handleFullNameChange}
                placeholder="John A. Doe"
              />
            </div>
            <div className="field-row">
              <label className="form-label">Date of Birth</label>
              <Input
                type="date"
                value={form.dob}
                onChange={set("dob")}
              />
            </div>
            <div className="field-row">
              <label className="form-label">Social Security Number</label>
              <Input
                value={form.ssn}
                onChange={set("ssn")}
                placeholder="XXX-XX-XXXX"
                maxLength={11}
              />
            </div>
            <div className="field-row">
              <label className="form-label">Requested Loan Amount</label>
              <Input
                value={form.loanAmount}
                onChange={set("loanAmount")}
                placeholder="$0.00"
              />
            </div>
          </div>

          <div className="field-row">
            <label className="form-label">Street Address</label>
            <Input value={form.address} onChange={set("address")} placeholder="123 Main St" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6">
            <div className="field-row sm:col-span-1">
              <label className="form-label">City</label>
              <Input value={form.city} onChange={set("city")} placeholder="Fitzgerald" />
            </div>
            <div className="field-row">
              <label className="form-label">State</label>
              <Input value={form.state} onChange={set("state")} placeholder="GA" maxLength={2} />
            </div>
            <div className="field-row">
              <label className="form-label">ZIP Code</label>
              <Input value={form.zip} onChange={set("zip")} placeholder="31750" maxLength={10} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <div className="field-row">
              <label className="form-label">Phone Number</label>
              <Input value={form.phone} onChange={set("phone")} placeholder="(229) 000-0000" />
            </div>
            <div className="field-row">
              <label className="form-label">Email Address</label>
              <Input value={form.email} onChange={set("email")} placeholder="you@example.com" type="email" />
            </div>
          </div>

          {/* Authorization Text */}
          <p className="section-title">Authorization &amp; Consent</p>

          <div className="consent-body">
            <p>
              I, the undersigned applicant, hereby authorize <strong>Colony City Finance</strong> and its agents, employees, or affiliates, to obtain a consumer credit report and/or
              any other investigative report from one or more consumer reporting agencies in connection with my application
              for a loan or extension of credit.
            </p>
            <p>
              I understand and acknowledge that this authorization is made pursuant to the <strong>Fair Credit Reporting
              Act (FCRA), 15 U.S.C. § 1681 et seq.</strong>, and that Colony City Finance will use this report solely to
              evaluate my creditworthiness for the purpose of the loan transaction described above.
            </p>
            <p>
              I further authorize <strong>Colony City Finance</strong> to verify any information provided in my application, including
              employment, income, and identity, through any lawful means. I certify that all information provided is
              true and accurate to the best of my knowledge.
            </p>
            <p>
              I understand I have rights under the FCRA, including the right to receive a copy of any consumer report
              obtained, and to dispute inaccurate information contained therein. I have read, understand, and agree to
              the terms of this authorization.
            </p>
            <p>
              This consent shall remain in effect for 90 days from the date signed below, or until my loan application
              is withdrawn or completed, whichever occurs first.
            </p>
          </div>

          {/* Signature Section */}
          <p className="section-title">Applicant Signature</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 items-end">
            <div className="field-row">
              <label className="form-label">
                Type Your Full Name to Sign
              </label>
              <Input
                value={form.signatureName}
                onChange={set("signatureName")}
                placeholder="Type name to sign"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Typing your name constitutes your legal electronic signature.
              </p>
            </div>
            <div className="field-row">
              <label className="form-label">Date</label>
              <Input
                value={form.signatureDate}
                onChange={set("signatureDate")}
              />
            </div>
          </div>

          {/* Live Signature Preview */}
          <div className="mt-2 mb-6">
            <label className="form-label">Signature Preview</label>
            <ScriptSignatureDisplay name={form.signatureName} />
          </div>

          {/* Footer */}
          <div style={{ fontSize: "0.72rem", color: "#888", borderTop: "1px solid #ddd", paddingTop: "0.75rem", marginTop: "0.5rem" }}>
            Colony City Finance · This document is protected under the Fair Credit Reporting Act (FCRA).
            Unauthorized use of this form or the information contained herein is prohibited.
          </div>
        </div>

        {/* Submission success */}
        {submitted && (
          <div className="mt-6 bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-start gap-3 no-print">
            <CheckCircle2 className="text-green-400 mt-0.5 shrink-0" size={18} />
            <div>
              <p className="text-sm font-semibold text-green-400">Consent form submitted!</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your authorization has been sent to Colony City Finance. A loan specialist will be in touch shortly.
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {submitError && (
          <p className="mt-4 text-sm text-red-400 no-print">{submitError}</p>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3 mt-6 no-print">
          {!submitted && (
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold px-6"
            >
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              {submitting ? "Submitting…" : "Submit Consent Form"}
            </Button>
          )}
          <Button
            onClick={handlePrint}
            variant="outline"
            className="gap-2 border-border/60"
          >
            <Printer size={15} />
            Print / Save as PDF
          </Button>
        </div>
      </div>
    </>
  );
}
