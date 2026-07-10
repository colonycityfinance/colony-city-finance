import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query"; // useQuery removed — AI calls proxied through server
import { apiRequest } from "@/lib/queryClient";
import DOMPurify from "dompurify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, RotateCcw, Phone, CheckCircle2, ShieldCheck, FileText } from "lucide-react";
import { Link } from "wouter";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function renderMarkdown(text: string) {
  const withMarkdown = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^\d+\.\s+/gm, '')      // strip leading numbered list markers (1. 2. etc)
    .replace(/^[-•]\s+/gm, '');      // strip bullet markers
  return DOMPurify.sanitize(withMarkdown, { ALLOWED_TAGS: ['strong', 'em', 'br'] });
}

function generateSessionId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function ChatPage() {
  const [sessionId] = useState(generateSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // AI calls go through our backend proxy (/api/chat) to avoid CORS

  // Save turn to backend
  const saveTurnMutation = useMutation({
    mutationFn: async ({ userMessage, assistantMessage }: { userMessage: string; assistantMessage: string }) => {
      await apiRequest("POST", "/api/turn", { sessionId, userMessage, assistantMessage });
    },
  });

  // Save lead to backend
  const saveLeadMutation = useMutation({
    mutationFn: async (leadData: Record<string, string>) => {
      await apiRequest("POST", "/api/save-lead", { sessionId, ...leadData });
    },
  });

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const API_BASE = "https://colony-city-finance.onrender.com";

  const callPerplexityAPI = async (history: ChatMessage[]): Promise<string> => {
    // Retry up to 3 times with a short delay — handles sandbox cold-start
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const response = await fetch(`${API_BASE}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history.map(m => ({ role: m.role, content: m.content })) }),
          signal: AbortSignal.timeout(30000), // 30s per attempt
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return data.reply ?? "";
      } catch (err) {
        if (attempt === 5) throw err;
        await new Promise(r => setTimeout(r, 3000 * attempt)); // 3s, 6s, 9s, 12s
      }
    }
    throw new Error("Chat unavailable");
  };

  const sendMessage = async (userMsg: string) => {
    if (isLoading || isComplete) return;

    const newHistory: ChatMessage[] = userMsg === "__start__"
      ? []
      : [...messages, { role: "user" as const, content: userMsg }];

    if (userMsg !== "__start__") {
      setMessages(newHistory);
    }

    setIsLoading(true);
    setInput("");

    try {
      const assistantText = await callPerplexityAPI(newHistory);

      // Check for qualification completion
      const qualMatch = assistantText.match(/<QUALIFICATION_COMPLETE>([\s\S]*?)<\/QUALIFICATION_COMPLETE>/);
      const cleanMessage = assistantText
        .replace(/<QUALIFICATION_COMPLETE>[\s\S]*?<\/QUALIFICATION_COMPLETE>/, "")
        .trim();

      const updatedMessages: ChatMessage[] = [
        ...newHistory,
        { role: "assistant" as const, content: cleanMessage },
      ];
      setMessages(updatedMessages);

      // Save turn to backend
      saveTurnMutation.mutate({
        userMessage: userMsg === "__start__" ? "hello" : userMsg,
        assistantMessage: assistantText,
      });

      if (qualMatch) {
        try {
          const qualData = JSON.parse(qualMatch[1].trim());
          saveLeadMutation.mutate({
            name: qualData.name,
            phone: qualData.phone,
            loanAmount: qualData.loanAmount,
            creditScore: qualData.creditScore,
            employmentStatus: qualData.employmentStatus,
            monthlyIncome: qualData.monthlyIncome,
            qualificationScore: qualData.score,
          });
          setIsComplete(true);
        } catch (e) {
          console.error("Failed to parse qualification data", e);
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Sorry, I ran into a problem. Please try again in a moment.",
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const startChat = () => {
    setIsStarted(true);
    sendMessage("__start__");
  };

  const handleSend = () => {
    if (!input.trim() || isLoading || isComplete) return;
    sendMessage(input.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const resetChat = async () => {
    await apiRequest("DELETE", `/api/history/${sessionId}`);
    setMessages([]);
    setIsComplete(false);
    setIsStarted(false);
  };

  if (!isStarted) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex flex-col items-center justify-center px-4 py-16">
        <div className="max-w-lg w-full text-center space-y-6">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 text-primary text-sm font-medium">
            <ShieldCheck size={15} />
            Fast. Secure. No credit impact.
          </div>

          <h1 className="text-3xl font-bold leading-tight">
            Find out if you qualify<br />
            <span className="text-primary">in under 2 minutes</span>
          </h1>

          <p className="text-muted-foreground text-base leading-relaxed">
            Chat with Steph, our AI loan advisor. Answer a few quick questions and a specialist will call you with your personal loan options — tailored to your situation.
          </p>

          <Button
            data-testid="button-start-chat"
            onClick={startChat}
            size="lg"
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-base py-6 rounded-xl shadow-lg"
          >
            Check My Eligibility →
          </Button>

          <div className="grid grid-cols-3 gap-4 pt-4">
            {[
              { icon: "🔒", label: "Secure & Private" },
              { icon: "📞", label: "Personal Callback" },
              { icon: "⚡", label: "Fast Decisions" },
            ].map((item) => (
              <div key={item.label} className="flex flex-col items-center gap-1.5 bg-card border border-border/60 rounded-xl p-3">
                <span className="text-2xl">{item.icon}</span>
                <span className="text-xs text-muted-foreground text-center leading-tight">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col" style={{ height: "calc(100vh - 3.5rem)" }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
              <span className="text-lg">💬</span>
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
          </div>
          <div>
            <p className="font-semibold text-sm">Steph — Loan Advisor</p>
            <p className="text-xs text-muted-foreground">Colony City Finance • Online now</p>
          </div>
        </div>
        <Button
          data-testid="button-reset-chat"
          variant="ghost"
          size="sm"
          onClick={resetChat}
          className="text-muted-foreground hover:text-foreground gap-1.5"
        >
          <RotateCcw size={14} />
          Start over
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto chat-scroll space-y-4 pb-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            data-testid={`message-${msg.role}-${i}`}
          >
            <div
              className={`max-w-[82%] px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user" ? "bubble-user" : "bubble-bot"
              }`}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
            />
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bubble-bot px-4 py-3 flex gap-1.5 items-center">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}

        {isComplete && (
          <div className="space-y-3">
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-start gap-3">
              <CheckCircle2 className="text-green-400 mt-0.5 shrink-0" size={18} />
              <div>
                <p className="text-sm font-semibold text-green-400">You're pre-qualified!</p>
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  <Phone size={11} />
                  A loan specialist will call you shortly to discuss your options.
                </p>
              </div>
            </div>
            <Link href="/consent">
              <button className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold text-sm py-3 px-4 rounded-xl hover:bg-primary/90 transition-colors shadow-md">
                <FileText size={15} />
                Complete Your Consent Form →
              </button>
            </Link>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {!isComplete && (
        <div className="flex gap-2 mt-2">
          <Input
            data-testid="input-chat-message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            disabled={isLoading}
            className="flex-1 bg-card border-border/60 focus:border-primary/60"
          />
          <Button
            data-testid="button-send-message"
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
          >
            <Send size={16} />
          </Button>
        </div>
      )}

      {isComplete && (
        <Button
          onClick={resetChat}
          variant="outline"
          className="mt-2 border-border/60"
          data-testid="button-new-application"
        >
          Start a new application
        </Button>
      )}
    </div>
  );
}
