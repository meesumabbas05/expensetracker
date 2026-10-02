import { amount } from './domain.js';

// Shared by local dispatch and Gemini validation. Parsing never performs writes.
export function parseCommand(input, categories = []) {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text || text.length > 1000 || /[\r\n]/.test(text)) return null;
  const lower = text.toLowerCase();
  if (/^help\s+expenses?$/.test(lower)) return { kind: 'help', valid: true, text };
  if (['cancel', 'no', 'yes'].includes(lower)) return { kind: 'session', valid: true, text };
  if (/^(household\s+)?(categories|loans)$/.test(lower)) return { kind: 'report', valid: true, text };
  if (/^budget(?:\s+.+)?$/i.test(text) || /^get\s+(?:(.+?)\s+)?budget(?:\s+detail)?$/i.test(text) || /^total\s+.+$/i.test(text)) return { kind: 'report', valid: true, text };
  if (/^(?:household\s+)?add\s+.+$/i.test(text)) return { kind: 'category', valid: true, text };
  const set = text.match(/^set\s+(household\s+)?(?:(.+?)\s+)?budget\s+(\S+)$/i);
  if (set) {
    try { amount(set[3]); } catch (error) { return { kind: 'budget', valid: false, error: error.message }; }
    return { kind: 'budget', valid: true, text };
  }
  const entry = text.match(/^(household\s+)?(expense|lend|borrow|collect|repay)\s+(\S+)(?:\s+(.+))?$/i);
  if (!entry) return null;
  try { amount(entry[3]); } catch (error) { return { kind: 'entry', valid: false, error: error.message }; }
  const kind = entry[2].toLowerCase();
  let description = entry[4]?.trim() || '';
  let category = null;
  if (kind === 'expense' && description.includes('|')) {
    const parts = description.split('|');
    if (parts.length !== 2 || !parts[0].trim()) return { kind: 'entry', valid: false, error: 'Use expense <amount> <description> | <category>.' };
    description = parts[0].trim();
    category = categories.find(c => c.toLowerCase() === parts[1].trim().toLowerCase());
    if (!category) return { kind: 'entry', valid: false, error: 'Unknown category. Send categories to see valid names.' };
  }
  if (description.length > 200) return { kind: 'entry', valid: false, error: 'Use a description under 200 characters.' };
  return { kind: 'entry', valid: true, text, entryKind: kind, description, category };
}
export function validGeneratedCommand(input, categories) {
  const parsed = parseCommand(input, categories);
  // AI must never save a pending entry by fabricating a yes response.
  return Boolean(parsed?.valid && parsed.kind !== 'session');
}
