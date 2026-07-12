import * as zkteco from './zktecoAdapter.js';
import * as csv_import from './genericCsvAdapter.js';

const adapters = { zkteco, csv_import };

// Adding a new vendor should only mean: one new adapter file + one line here.
export function getAdapter(vendor) {
  return adapters[vendor?.toLowerCase()];
}
