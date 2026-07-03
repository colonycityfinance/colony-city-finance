/**
 * storage.ts — JSON file-based storage
 * Zero native dependencies, zero WASM. Works in any Node.js sandbox.
 * Data is persisted to data.json in the project root (same location as data.db was).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { InsertLead, Lead, InsertMessage, Message } from "@shared/schema";

const DATA_PATH = resolve("data.json");

interface DataStore {
  leads: Lead[];
  messages: Message[];
  nextLeadId: number;
  nextMessageId: number;
}

let store: DataStore = {
  leads: [],
  messages: [],
  nextLeadId: 1,
  nextMessageId: 1,
};

function load() {
  try {
    if (existsSync(DATA_PATH)) {
      const raw = readFileSync(DATA_PATH, "utf-8");
      store = JSON.parse(raw);
    }
  } catch (e) {
    console.error("Failed to load data.json, starting fresh:", e);
  }
}

function persist() {
  try {
    writeFileSync(DATA_PATH, JSON.stringify(store, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to persist data.json:", e);
  }
}

// Initialize synchronously at module load
load();
console.log(`Storage ready — ${store.leads.length} leads, ${store.messages.length} messages`);

export async function initDb() {
  // Nothing async needed — already loaded synchronously above
  // This function exists so server/index.ts can await it uniformly
}

export interface IStorage {
  createLead(lead: InsertLead): Lead;
  getLeads(): Lead[];
  getLead(id: number): Lead | undefined;
  createMessage(message: InsertMessage): Message;
  getMessagesBySession(sessionId: string): Message[];
  deleteMessagesBySession(sessionId: string): void;
}

export const storage: IStorage = {
  createLead(lead: InsertLead): Lead {
    const id = store.nextLeadId++;
    const newLead: Lead = { id, ...lead };
    store.leads.push(newLead);
    persist();
    return newLead;
  },

  getLeads(): Lead[] {
    return [...store.leads];
  },

  getLead(id: number): Lead | undefined {
    return store.leads.find((l) => l.id === id);
  },

  createMessage(message: InsertMessage): Message {
    const id = store.nextMessageId++;
    const newMessage: Message = { id, ...message };
    store.messages.push(newMessage);
    persist();
    return newMessage;
  },

  getMessagesBySession(sessionId: string): Message[] {
    return store.messages.filter((m) => m.sessionId === sessionId);
  },

  deleteMessagesBySession(sessionId: string): void {
    store.messages = store.messages.filter((m) => m.sessionId !== sessionId);
    persist();
  },
};
