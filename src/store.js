import { google } from 'googleapis';
const HEADER = ['ID', 'Timestamp', 'Date', 'Month', 'Account', 'Actor', 'Kind', 'AmountMinor', 'Description', 'Category'];
export class SheetStore {
  constructor(config) {
    this.id = config.sheetId;
    this.api = google.sheets({ version: 'v4', auth: new google.auth.GoogleAuth({ credentials: config.credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) });
  }
  async init() {
    const { data } = await this.api.spreadsheets.get({ spreadsheetId: this.id, fields: 'sheets.properties.title' });
    if (!data.sheets.some(s => s.properties.title === 'Ledger')) await this.api.spreadsheets.batchUpdate({ spreadsheetId: this.id, requestBody: { requests: [{ addSheet: { properties: { title: 'Ledger' } } }] } });
    const result = await this.api.spreadsheets.values.get({ spreadsheetId: this.id, range: 'Ledger!A1:J1' });
    if (!result.data.values?.length) await this.api.spreadsheets.values.update({ spreadsheetId: this.id, range: 'Ledger!A1:J1', valueInputOption: 'RAW', requestBody: { values: [HEADER] } });
    else if (JSON.stringify(result.data.values[0]) !== JSON.stringify(HEADER)) throw new Error('Ledger header mismatch');
  }
  async rows() {
    const { data } = await this.api.spreadsheets.values.get({ spreadsheetId: this.id, range: 'Ledger!A2:J' });
    return (data.values || []).map(r => {
      if (r.length !== 10 || !Number.isSafeInteger(Number(r[7])) || Number(r[7]) <= 0 || !['expense', 'budget', 'lend', 'borrow', 'collect', 'repay'].includes(r[6]) || !/^\d{4}-\d{2}$/.test(r[3])) throw new Error('Invalid ledger row');
      return { id: r[0], timestamp: r[1], date: r[2], month: r[3], account: r[4], actor: r[5], kind: r[6], amount: Number(r[7]), description: r[8], category: r[9] };
    });
  }
  async append(r) {
    // Read before append makes redelivery/restarts idempotent after uncertain writes.
    if ((await this.rows()).some(x => x.id === r.id)) return false;
    await this.api.spreadsheets.values.append({ spreadsheetId: this.id, range: 'Ledger!A:J', valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [[r.id, r.timestamp, r.date, r.month, r.account, r.actor, r.kind, r.amount, r.description, r.category]] } });
    return true;
  }
}
