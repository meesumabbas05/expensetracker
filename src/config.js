import 'dotenv/config';
export function readConfig(env = process.env) {
  env = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
  const users = JSON.parse(env.USERS_JSON || '[]').map(u => ({ ...u, id: u.id?.trim(), name: u.name?.trim(), whatsappIds: u.whatsappIds?.map(id => id.trim()) }));
  const categories = JSON.parse(env.CATEGORIES_JSON || '["House expenses","Groceries","Fuel","Dine-out","Sports","Utilities","Shopping","Health","Travel","Other"]');
  for (let i = 0; i < categories.length; i++) if (typeof categories[i] === 'string') categories[i] = categories[i].trim();
  if (!users.length || users.some(u => !/^[a-z][a-z0-9_-]*$/.test(u.id) || u.id === 'household' || !u.name?.trim() || !Array.isArray(u.whatsappIds) || !u.whatsappIds.length || u.whatsappIds.some(id => !/^\d+@(c\.us|lid)$/.test(id)))) throw new Error('Invalid USERS_JSON configuration');
  if (new Set(users.map(u => u.id)).size !== users.length || new Set(users.flatMap(u => u.whatsappIds)).size !== users.flatMap(u => u.whatsappIds).length) throw new Error('Duplicate user IDs or WhatsApp IDs');
  const aliases = users.flatMap(u => [u.id.toLowerCase(), u.name.toLowerCase()]);
  if (users.some((u, i) => users.some((v, j) => i !== j && [u.id.toLowerCase(), u.name.toLowerCase()].some(a => [v.id.toLowerCase(), v.name.toLowerCase()].includes(a)))) || aliases.includes('household')) throw new Error('Ambiguous user names');
  if (categories.length !== 10 || categories.some(c => typeof c !== 'string' || !c.trim() || c.length > 60) || new Set(categories.map(c => c.toLowerCase())).size !== 10) throw new Error('Exactly 10 unique categories required');
  const categoryBudgets = { shopping: env.SHOPPING_CATEGORY?.trim() || 'Shopping', 'dine-out': env.DINE_OUT_CATEGORY?.trim() || 'Dine-out' };
  if (Object.values(categoryBudgets).some(c => !categories.includes(c)) || categoryBudgets.shopping === categoryBudgets['dine-out']) throw new Error('Category budget labels must match two distinct configured categories');
  const timezone = env.TIMEZONE?.trim() || 'Asia/Karachi';
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
  if (!env.GOOGLE_SHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error('Google Sheets configuration missing');
  const ttl = Number(env.SESSION_TTL_MINUTES || 15);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('Invalid session TTL');
  return { users, categories, categoryBudgets, timezone, currency: env.CURRENCY || 'PKR', sheetId: env.GOOGLE_SHEET_ID, credentials: JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON), dataDir: env.DATA_DIR || './data', clientId: env.WHATSAPP_CLIENT_ID || 'expense-tracker', chromePath: env.CHROME_EXECUTABLE_PATH || undefined, noSandbox: env.CHROME_NO_SANDBOX === 'true', showQr: env.SHOW_QR === 'true', ttl: ttl * 60000, geminiKey: env.GEMINI_API_KEY, geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash', geminiEnabled: env.GEMINI_ENABLED !== 'false' };
}
