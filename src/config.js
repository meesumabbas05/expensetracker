import 'dotenv/config';
import { amount } from './domain.js';
export function readConfig(env = process.env) {
  env = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
  const transport = env.BOT_TRANSPORT || 'whatsapp';
  if (!['whatsapp', 'discord'].includes(transport)) throw new Error('BOT_TRANSPORT must be whatsapp or discord');
  const configuredUsers = JSON.parse(env.USERS_JSON || '[]');
  if (!Array.isArray(configuredUsers)) throw new Error('Invalid USERS_JSON configuration');
  const users = configuredUsers.map(u => ({ ...u, id: typeof u?.id === 'string' ? u.id.trim() : '', name: typeof u?.name === 'string' ? u.name.trim() : '' }));
  if (!users.length || users.some(u => !/^[a-z][a-z0-9_-]*$/.test(u.id) || u.id === 'household' || !u.name)) throw new Error('Invalid USERS_JSON configuration');
  const identityKey = transport === 'discord' ? 'discordIds' : 'whatsappIds';
  const identityPattern = transport === 'discord' ? /^\d{17,20}$/ : /^\d+@(c\.us|lid)$/;
  for (const user of users) {
    if (!Array.isArray(user[identityKey]) || !user[identityKey].length || user[identityKey].some(id => typeof id !== 'string' || !identityPattern.test(id.trim()))) throw new Error(`Invalid ${identityKey} in USERS_JSON`);
    user[identityKey] = user[identityKey].map(id => id.trim());
  }
  const identities = users.flatMap(u => u[identityKey]);
  if (new Set(users.map(u => u.id)).size !== users.length || new Set(identities).size !== identities.length) throw new Error('Duplicate user IDs or transport identities');
  const aliases = users.flatMap(u => [u.id.toLowerCase(), u.name.toLowerCase()]);
  if (users.some((u, i) => users.some((v, j) => i !== j && [u.id.toLowerCase(), u.name.toLowerCase()].some(a => [v.id.toLowerCase(), v.name.toLowerCase()].includes(a)))) || aliases.includes('household')) throw new Error('Ambiguous user names');
  const categories = JSON.parse(env.CATEGORIES_JSON || '["House expenses","Groceries","Fuel","Dine-out","Sports","Utilities","Shopping","Health","Travel","Other"]');
  if (!Array.isArray(categories)) throw new Error('Invalid CATEGORIES_JSON');
  for (let i = 0; i < categories.length; i++) if (typeof categories[i] === 'string') categories[i] = categories[i].trim();
  if (!categories.length || categories.some(c => typeof c !== 'string' || !c || c.length > 60) || new Set(categories.map(c => c.toLowerCase())).size !== categories.length) throw new Error('Unique nonempty categories required');
  const shopping = env.SHOPPING_CATEGORY || 'Shopping';
  const dineOut = env.DINE_OUT_CATEGORY || 'Dine-out';
  if (![shopping, dineOut].every(c => categories.includes(c)) || shopping === dineOut) throw new Error('Category budget labels must match two distinct configured categories');
  for (const name of ['Short-term', 'Long-term']) if (!categories.some(c => c.toLowerCase() === name.toLowerCase())) categories.push(name);
  const householdCategories = JSON.parse(env.HOUSEHOLD_CATEGORIES_JSON || JSON.stringify(categories.filter(c => ['house expenses', 'house', 'groceries', 'fuel'].includes(c.toLowerCase()))));
  if (!Array.isArray(householdCategories) || householdCategories.some(c => typeof c !== 'string' || !categories.includes(c)) || new Set(householdCategories).size !== householdCategories.length || householdCategories.some(c => [shopping, dineOut].includes(c) || ['short-term', 'long-term'].includes(c.toLowerCase()))) throw new Error('Invalid HOUSEHOLD_CATEGORIES_JSON');
  const combinedBudget = 'Shopping & Dine-out';
  const categoryBudgets = {
    shopping: combinedBudget,
    'dine-out': combinedBudget,
    'shopping & dine-out': combinedBudget,
    'shopping and dine-out': combinedBudget,
    investments: 'Investments'
  };
  const categoryFunding = Object.fromEntries(categories.map(category => {
    let source = 'Budget';
    if (householdCategories.includes(category)) source = 'household';
    else if ([shopping, dineOut].includes(category)) source = combinedBudget;
    else if (['short-term', 'long-term'].includes(category.toLowerCase())) source = 'Investments';
    return [category, source];
  }));
  const defaultMonthlyBudget = amount(env.DEFAULT_MONTHLY_BUDGET || '25000');
  const timezone = env.TIMEZONE?.trim() || 'Asia/Karachi';
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
  if (!env.GOOGLE_SHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error('Google Sheets configuration missing');
  if (transport === 'discord' && !env.DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN is required for Discord');
  if (transport === 'discord' && env.DISCORD_CHANNEL_ID && !/^\d{17,20}$/.test(env.DISCORD_CHANNEL_ID)) throw new Error('Invalid DISCORD_CHANNEL_ID');
  const ttl = Number(env.SESSION_TTL_MINUTES || 15);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('Invalid session TTL');
  return { transport, users, categories, categoryBudgets, categoryFunding, defaultMonthlyBudget, timezone, currency: env.CURRENCY || 'PKR', sheetId: env.GOOGLE_SHEET_ID, credentials: JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON), dataDir: env.DATA_DIR || './data', clientId: env.WHATSAPP_CLIENT_ID || 'expense-tracker', chromePath: env.CHROME_EXECUTABLE_PATH || undefined, noSandbox: env.CHROME_NO_SANDBOX === 'true', showQr: env.SHOW_QR === 'true', discordToken: env.DISCORD_BOT_TOKEN, discordChannelId: env.DISCORD_CHANNEL_ID || null, ttl: ttl * 60000, geminiKey: env.GEMINI_API_KEY, geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash', geminiEnabled: env.GEMINI_ENABLED !== 'false' };
}
